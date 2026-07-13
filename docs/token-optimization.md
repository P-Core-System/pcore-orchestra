# OpenCode Token Optimization Guide

Maximize coding performance per token spent. Every technique here is based on OpenCode's official config options and proven prompting patterns.

## Table of Contents

- [The Token Budget Problem](#token-budget)
- [Config-Level Optimizations](#config-optimizations)
  - [Compaction & Pruning](#compaction)
  - [Model Selection Per Task](#model-selection)
  - [Reasoning Effort & Verbosity](#reasoning-variants)
  - [Agent Steps Limits](#steps-limits)
  - [Small Model for Title/Summary](#small-model)
  - [Disable Unnecessary Tools](#tools-config)
  - [Watcher & Snapshot](#watcher-snapshot)
- [Orchestration Token Strategies](#orchestra-tokens)
  - [Phase-Specific Models](#phase-models)
  - [Planner Efficiency](#planner-efficiency)
  - [Verifier Minimalism](#verifier-minimalism)
  - [Reviewer Read-Only](#reviewer-readonly)
  - [Iteration Limits](#iteration-limits)
- [Prompt Engineering for Tokens](#prompt-engineering)
- [Cost-Aware Model Selection](#cost-aware)
- [Full Optimized Config](#full-config)

---

## The Token Budget Problem {#token-budget}

Every OpenCode session consumes tokens on:

| Token source | % of total | What controls it |
|-------------|-----------|-----------------|
| System prompt + rules | 5-15% | AGENTS.md length, instructions count |
| File reads (context) | 20-40% | How many files agent reads per step |
| Tool call results | 15-30% | Bash output size, file read size |
| Agent responses | 20-40% | Verbosity, reasoning effort |
| Subagent overhead | 10-25% | Each subagent gets its own system prompt |

**Orchestra runs 4 subagents per cycle** (planner → implementer → verifier → reviewer). Each subagent re-sends the system prompt + context. A single orchestra cycle can consume 4-10x the tokens of a direct prompt.

**Key insight:** The biggest token savings come from reducing what each agent reads, not from writing shorter prompts.

---

## Config-Level Optimizations {#config-optimizations}

### Compaction & Pruning {#compaction}

OpenCode can automatically compact long sessions and prune old tool outputs.

```jsonc
// opencode.json
{
  "compaction": {
    "auto": true,      // Auto-compact when context is full (default: true)
    "prune": true,      // Remove old tool outputs to save tokens (default: false)
    "reserved": 8000    // Token buffer for compaction (default: 10000)
  }
}
```

**`prune: true`** is the single most impactful token saver. Old bash outputs, file reads, and tool results get removed from context after they're no longer needed. This can reduce token usage by 30-50% in long sessions.

**`reserved: 8000`** leaves enough window to avoid overflow during compaction. Lower = more aggressive compaction, but risk of context overflow mid-response.

### Model Selection Per Task {#model-selection}

Use different models for different work. The `model` and `small_model` config fields control this globally.

```jsonc
{
  // Main model for coding tasks
  "model": "opencode/deepseek-v4-flash",
  
  // Cheap model for titles, summaries, lightweight tasks
  "small_model": "opencode/gpt-5-nano"
}
```

**Model tiers for coding (as of July 2026):**

| Tier | Model | Input $/1M | Output $/1M | Best for |
|------|-------|-----------|------------|----------|
| Free | `deepseek-v4-flash-free` | $0 | $0 | Light tasks, testing |
| Budget | `gpt-5-nano` | $0.05 | $0.40 | Titles, summaries |
| Budget+ | `deepseek-v4-flash` | $0.14 | $0.28 | Daily coding, orchestration |
| Mid | `kimi-k2.5` | $0.60 | $3.00 | Complex implementation |
| Mid+ | `qwen3.7-plus` | $0.40 | $1.60 | Multi-step reasoning |
| High | `claude-sonnet-5` | $2.00 | $10.00 | Architecture, complex refactors |
| Premium | `claude-opus-4.7` | $5.00 | $25.00 | Critical decisions, debugging |

**Cached read pricing matters:** Models like Qwen3.7 Max charge $0.50 for cached reads vs $2.50 for fresh input. Repeated context (AGENTS.md, architecture docs) gets cached automatically.

### Reasoning Effort & Verbosity {#reasoning-variants}

OpenAI and Anthropic models support reasoning variants. Use them to control token consumption:

```jsonc
{
  "provider": {
    "opencode": {
      "models": {
        "deepseek-v4-flash": {
          "variants": {
            "fast": {
              "reasoningEffort": "low",
              "textVerbosity": "low"
            },
            "balanced": {
              "reasoningEffort": "medium"
            },
            "thorough": {
              "reasoningEffort": "high",
              "textVerbosity": "low"
            }
          }
        }
      }
    }
  }
}
```

**`textVerbosity: "low"`** reduces output tokens without losing information. Use it on all models that support it.

**Anthropic thinking budget:**
```jsonc
{
  "provider": {
    "anthropic": {
      "models": {
        "claude-sonnet-5": {
          "variants": {
            "fast": {
              "thinking": { "type": "enabled", "budgetTokens": 4000 }
            },
            "thorough": {
              "thinking": { "type": "enabled", "budgetTokens": 16000 }
            }
          }
        }
      }
    }
  }
}
```

### Agent Steps Limits {#steps-limits}

Limit agentic iterations per agent to prevent runaway token consumption:

```jsonc
{
  "agent": {
    "orchestra-planner": {
      "steps": 8    // Max 8 tool calls before forced text response
    },
    "orchestra-implementer": {
      "steps": 25   // More steps for implementation
    },
    "orchestra-verifier": {
      "steps": 10   // Tests + lint don't need many steps
    },
    "orchestra-reviewer": {
      "steps": 5    // Review is read-only, few steps needed
    }
  }
}
```

When the limit is reached, the agent gets a special prompt to summarize work and recommend remaining tasks. This prevents infinite loops that burn tokens.

### Small Model for Title/Summary {#small-model}

OpenCode uses a separate model for session titles and summaries. Set it to the cheapest option:

```jsonc
{
  "small_model": "opencode/gpt-5-nano"
}
```

This saves $0.50-5.00 per session by using a $0.05/1M model instead of your main model for metadata generation.

### Disable Unnecessary Tools {#tools-config}

If an agent doesn't need certain tools, disable them to reduce the tool description tokens in the system prompt:

```jsonc
{
  "agent": {
    "orchestra-planner": {
      "permission": {
        "edit": "deny",
        "bash": "ask"
      }
    },
    "orchestra-reviewer": {
      "permission": {
        "edit": "deny",
        "bash": "ask",
        "websearch": "deny",
        "webfetch": "deny"
      }
    }
  }
}
```

Each disabled tool removes its description from the agent's context, saving 100-500 tokens per agent.

### Watcher & Snapshot {#watcher-snapshot}

Reduce overhead for large repos:

```jsonc
{
  "watcher": {
    "ignore": [
      "node_modules/**",
      "dist/**",
      ".git/**",
      "build/**",
      "coverage/**",
      "*.min.js",
      "*.min.css"
    ]
  },
  "snapshot": false  // Disable if repo is large (no undo within session)
}
```

---

## Orchestration Token Strategies {#orchestra-tokens}

Orchestra's 4-subagent cycle is the biggest token consumer. These strategies minimize waste.

### Phase-Specific Models {#phase-models}

Use a cheap model for read-only phases and a strong model for implementation:

```jsonc
{
  "agent": {
    "orchestra-planner": {
      "model": "opencode/deepseek-v4-flash",      // Budget: read + plan
      "steps": 8,
      "permission": { "edit": "deny", "bash": "ask" }
    },
    "orchestra-implementer": {
      "model": "opencode/kimi-k2.5",              // Mid: actual coding
      "steps": 25,
      "permission": { "edit": "allow", "bash": "allow" }
    },
    "orchestra-verifier": {
      "model": "opencode/deepseek-v4-flash",      // Budget: run checks
      "steps": 10,
      "permission": { "edit": "deny", "bash": "allow" }
    },
    "orchestra-reviewer": {
      "model": "opencode/deepseek-v4-flash",      // Budget: read-only review
      "steps": 5,
      "permission": { "edit": "deny", "bash": "ask" }
    }
  }
}
```

**Cost per orchestra cycle (before optimization):**
- 4 subagents x Claude Sonnet 5: ~$0.15-0.40 per cycle

**Cost per cycle (after optimization):**
- Planner + Verifier + Reviewer on deepseek-v4-flash: ~$0.01-0.03
- Implementer on kimi-k2.5: ~$0.02-0.08
- **Total: ~$0.03-0.11 per cycle** (60-75% savings)

### Planner Efficiency {#planner-efficiency}

The planner should read minimal context. Instruct it to:

1. Read only the 3 most relevant files (not all 6 context files)
2. Use `grep`/`glob` to find relevant code instead of reading entire files
3. Output a plan under 50 lines (not 80)

```markdown
## Token-efficient planner instructions

When planning:
- Read AGENTS.md and progress-tracker.md first (always)
- Read architecture.md ONLY if the task involves system design
- Read code-standards.md ONLY if implementing new code patterns
- Use grep/glob to find relevant files — do NOT read entire directories
- Output plan under 50 lines with concrete file paths
- Include estimated token cost in the plan if >3 files need changes
```

### Verifier Minimalism {#verifier-minimalism}

The verifier should run the cheapest checks first:

1. Syntax check (near-zero tokens)
2. Targeted test (one test file, not full suite)
3. Lint (if available)
4. Only run full test suite if previous checks pass

```markdown
## Token-efficient verifier instructions

Check order (cheapest first):
1. Syntax: `node --check <file>` or `python -m py_compile <file>` (0 tokens)
2. Type: `npx tsc --noEmit 2>&1 | head -20` (minimal tokens)
3. Targeted test: run ONLY tests related to changed files
4. Lint: project linter if available
5. Full test suite: ONLY if all above pass

Never run full test suite as first check. It's the most expensive.
```

### Reviewer Read-Only {#reviewer-readonly}

The reviewer should never execute code. Keep it cheap:

```markdown
## Token-efficient reviewer instructions

- Read only: git diff, verifier report, progress-tracker.md
- Do NOT run bash commands (except git diff)
- Focus on 3 things: correctness, scope creep, missing tests
- Output under 30 lines
- If everything looks good, just say ORCHESTRA_COMPLETE
```

### Iteration Limits {#iteration-limits}

The orchestra state tracks `max_iterations` (default: 8). Each iteration = full 4-subagent cycle.

For cost control, reduce to 4-5 for budget workloads:

```jsonc
// In opencode.json or AGENTS.md instructions
{
  "max_iterations": 5  // Cap orchestra at 5 cycles
}
```

Or in the orchestra skill instructions:

```markdown
Cost-aware orchestration:
- Max iterations: 5 (not 8) when using budget models
- Max iterations: 3 when using free models
- If iteration 3 still has FIX_REQUIRED, stop and ask user for direction
```

---

## Prompt Engineering for Tokens {#prompt-engineering}

### Effective prompts save 50-70% of tokens

| Weak prompt | Token-heavy response | Strong prompt | Token-efficient response |
|-------------|---------------------|---------------|------------------------|
| "Fix this" | Agent reads 10+ files to understand context | "Fix the null pointer in auth.ts:42 when session expires. Use the pattern from auth.ts:15-25" | Agent reads 2 files, targeted fix |
| "Make it faster" | Agent benchmarks, profiles, suggests 5 approaches | "Optimize calculateTotal() in utils.ts for O(n) — currently O(n²) due to nested loop" | Agent finds the loop, fixes it |
| "Add tests" | Agent reads entire test suite, writes 50 tests | "Add 3 unit tests for parseConfig() in config.ts — test empty input, valid JSON, malformed JSON" | Agent writes exactly 3 tests |
| "Review my code" | Agent reads all changed files + context | "Review the diff in api/routes.ts — focus on SQL injection and auth bypass" | Agent checks 2 specific risks |

### Reference files lazily

Instead of loading all context files upfront, reference them by need:

```markdown
# In AGENTS.md

## File references (load on demand)
- Architecture decisions: @context/architecture.md
- Code conventions: @context/code-standards.md  
- Current progress: @context/progress-tracker.md

CRITICAL: Only load these files when the task specifically needs them.
Do NOT read all files at session start.
```

### Use `/init` to generate lean AGENTS.md

Run `/init` in OpenCode to generate a project-specific AGENTS.md that's concise. A 200-line AGENTS.md costs ~500 tokens per agent per step. A 50-line AGENTS.md costs ~150 tokens.

---

## Cost-Aware Model Selection {#cost-aware}

### Decision matrix

| Task type | Recommended model | Cost per task |
|-----------|------------------|--------------|
| Session title | `gpt-5-nano` | $0.001 |
| Quick question | `deepseek-v4-flash` | $0.005 |
| Bug fix (targeted) | `deepseek-v4-flash` | $0.01-0.03 |
| Feature implementation | `kimi-k2.5` or `qwen3.7-plus` | $0.03-0.10 |
| Complex refactor | `claude-sonnet-5` | $0.10-0.30 |
| Architecture decision | `claude-opus-4.7` | $0.20-0.50 |
| Orchestra cycle (budget) | mix of flash + kimi | $0.03-0.11 |
| Orchestra cycle (premium) | all sonnet-5 | $0.15-0.40 |

### Free model limitations

Free models (`*-free`) work for:
- Simple bug fixes
- Code exploration
- Documentation
- Boilerplate generation

Free models struggle with:
- Multi-step orchestration (may hit rate limits mid-cycle)
- Complex architectural decisions
- Large codebase navigation (limited context window)
- Debugging intricate issues

**Recommendation:** Use free models for the planner and verifier (read-only, simpler tasks). Use a paid model for the implementer (complex coding).

---

## Full Optimized Config {#full-config}

Here's a complete optimized `opencode.json` for cost-effective orchestra usage:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  
  // Main model: balance of cost and capability
  "model": "opencode/deepseek-v4-flash",
  
  // Cheap model for titles/summaries
  "small_model": "opencode/gpt-5-nano",
  
  // Aggressive compaction
  "compaction": {
    "auto": true,
    "prune": true,
    "reserved": 8000
  },
  
  // Ignore noisy directories
  "watcher": {
    "ignore": [
      "node_modules/**",
      "dist/**",
      ".git/**",
      "build/**",
      "coverage/**"
    ]
  },
  
  // Agent-specific optimization
  "agent": {
    "orchestra-planner": {
      "model": "opencode/deepseek-v4-flash",
      "steps": 8,
      "permission": {
        "edit": "deny",
        "bash": "ask",
        "websearch": "deny"
      }
    },
    "orchestra-implementer": {
      "model": "opencode/kimi-k2.5",
      "steps": 25
    },
    "orchestra-verifier": {
      "model": "opencode/deepseek-v4-flash",
      "steps": 10,
      "permission": {
        "edit": "deny",
        "bash": "allow"
      }
    },
    "orchestra-reviewer": {
      "model": "opencode/deepseek-v4-flash",
      "steps": 5,
      "permission": {
        "edit": "deny",
        "bash": "ask",
        "websearch": "deny",
        "webfetch": "deny"
      }
    }
  },
  
  // Model variants for cost control
  "provider": {
    "opencode": {
      "models": {
        "deepseek-v4-flash": {
          "variants": {
            "fast": {
              "reasoningEffort": "low",
              "textVerbosity": "low"
            },
            "thorough": {
              "reasoningEffort": "high"
            }
          }
        }
      }
    }
  }
}
```

**Expected savings:** 50-70% token reduction compared to default config, with comparable coding quality for most tasks.
