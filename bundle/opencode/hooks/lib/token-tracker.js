"use strict";

const path = require("node:path");
const {
  TOKEN_HISTORY_MAX_RUNS,
  TOKEN_TIPS_MAX,
  TOKEN_CONTEXT_RUNS,
} = require("./constants.js");
const { writeJson, readJsonSafe, resolveStatePath } = require("./safe-write.js");

const TOKENS_PATH = path.join(__dirname, "..", "state", "orchestra-tokens.json");

/** Per-agent design budgets (see docs/token-optimization.md). */
const AGENT_BUDGETS = {
  "orchestra-planner": 10000,
  "orchestra-implementer": 30000,
  "orchestra-verifier": 15000,
  "orchestra-reviewer": 8000,
};

const CYCLE_BUDGET = 63000;

const DEFAULT_SESSION_TOKENS = {
  runs: [],
  aggregates: {
    total_runs: 0,
    total_tokens_estimated: 0,
    total_tokens_reported: 0,
    total_cache_read: 0,
    by_agent: {},
    by_phase: {},
  },
  tips: [],
  last_summary: null,
};

const DEFAULT_TOKEN_STATE = {
  version: 1,
  sessions: {},
};

/** Get the session ID from environment variables. */
function getSessionId() {
  return (
    process.env.PCORE_SESSION_ID ||
    process.env.OPENCODE_SESSION_ID ||
    process.env.CLAUDE_SESSION_ID ||
    process.env.CURSOR_TRACE_ID ||
    process.env.QODER_SESSION_ID ||
    process.env.QODER_PID ||
    "pid-" + process.pid
  );
}

/** Migrate legacy flat token state to session-namespaced structure. */
function migrateToSessions(raw) {
  if (raw && raw.sessions && typeof raw.sessions === "object") {
    return raw;
  }

  const sessionId = getSessionId();
  const migrated = {
    version: 1,
    sessions: {},
  };
  migrated.sessions[sessionId] = { ...DEFAULT_SESSION_TOKENS, ...(raw || {}) };
  return migrated;
}

function estimateTokens(text) {
  if (!text || typeof text !== "string") return 0;
  return Math.ceil(text.length / 4);
}

function extractOutputText(input) {
  if (!input || typeof input !== "object") return "";
  return (
    input.summary ||
    input.result ||
    input.output ||
    input.final_text ||
    input.text ||
    ""
  );
}

/** Parse usage when Cursor/API exposes token fields on hook input. */
function extractReportedUsage(input) {
  if (!input || typeof input !== "object") return null;

  // Cache fields follow the Anthropic-style usage shape most hosts pass
  // through: `cache_read_input_tokens` counts tokens served from prompt
  // cache (billed at a discount), `cache_creation_input_tokens` tokens
  // written to it. Hit rate is read/(read + fresh prompt).
  const readOf = (usage) =>
    usage.cache_read_input_tokens ??
    usage.cacheReadInputTokens ??
    usage.cached_tokens ??
    0;
  const creationOf = (usage) =>
    usage.cache_creation_input_tokens ?? usage.cacheCreationInputTokens ?? 0;

  const candidates = [
    input.usage,
    input.token_usage,
    input.tokens,
    input.metrics,
  ].filter(Boolean);

  for (const usage of candidates) {
    if (typeof usage !== "object") continue;
    const prompt =
      usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens ?? null;
    const completion =
      usage.completion_tokens ??
      usage.output_tokens ??
      usage.completionTokens ??
      null;
    let total = usage.total_tokens ?? usage.totalTokens ?? null;
    if (total == null && prompt != null && completion != null) {
      total = prompt + completion;
    }
    if (prompt != null || completion != null || total != null) {
      return {
        prompt_tokens: prompt ?? 0,
        completion_tokens: completion ?? 0,
        total_tokens: total ?? 0,
        cache_read_tokens: readOf(usage),
        cache_creation_tokens: creationOf(usage),
        source: "reported",
      };
    }
  }

  const prompt = input.prompt_tokens ?? input.input_tokens;
  const completion = input.completion_tokens ?? input.output_tokens;
  const total = input.total_tokens;
  if (prompt != null || completion != null || total != null) {
    return {
      prompt_tokens: prompt ?? 0,
      completion_tokens: completion ?? 0,
      total_tokens: total ?? (prompt ?? 0) + (completion ?? 0),
      cache_read_tokens: readOf(input),
      cache_creation_tokens: creationOf(input),
      source: "reported",
    };
  }

  return null;
}

function loadTokenState(sessionId) {
  const session = sessionId || getSessionId();
  try {
    const raw = readJsonSafe(resolveStatePath(TOKENS_PATH), { version: 1, sessions: {} });
    const migrated = migrateToSessions(raw);

    if (!migrated.sessions[session]) {
      migrated.sessions[session] = { ...DEFAULT_SESSION_TOKENS };
    }

    return migrated;
  } catch {
    const empty = { version: 1, sessions: {} };
    empty.sessions[session] = { ...DEFAULT_SESSION_TOKENS };
    return empty;
  }
}

/** Get aggregated token state across all sessions. */
function getAggregatedTokenState(tokenState) {
  if (!tokenState.sessions) return { ...DEFAULT_SESSION_TOKENS };

  const aggregated = { ...DEFAULT_SESSION_TOKENS };
  for (const [, sessionTokens] of Object.entries(tokenState.sessions)) {
    if (!sessionTokens) continue;
    aggregated.runs.push(...(sessionTokens.runs || []));

    const agg = sessionTokens.aggregates;
    if (agg) {
      aggregated.aggregates.total_runs += agg.total_runs || 0;
      aggregated.aggregates.total_tokens_estimated += agg.total_tokens_estimated || 0;
      aggregated.aggregates.total_tokens_reported += agg.total_tokens_reported || 0;
      aggregated.aggregates.total_cache_read += agg.total_cache_read || 0;

      for (const [agent, data] of Object.entries(agg.by_agent || {})) {
        if (!aggregated.aggregates.by_agent[agent]) {
          aggregated.aggregates.by_agent[agent] = {
            count: 0,
            total_tokens: 0,
            over_budget: 0,
            avg_tokens: 0,
          };
        }
        const target = aggregated.aggregates.by_agent[agent];
        target.count += data.count || 0;
        target.total_tokens += data.total_tokens || 0;
        target.over_budget += data.over_budget || 0;
        target.avg_tokens =
          target.count > 0 ? Math.round(target.total_tokens / target.count) : 0;
      }

      for (const [phase, data] of Object.entries(agg.by_phase || {})) {
        if (!aggregated.aggregates.by_phase[phase]) {
          aggregated.aggregates.by_phase[phase] = {
            count: 0,
            total_tokens: 0,
            over_budget: 0,
            avg_tokens: 0,
          };
        }
        const target = aggregated.aggregates.by_phase[phase];
        target.count += data.count || 0;
        target.total_tokens += data.total_tokens || 0;
        target.over_budget += data.over_budget || 0;
        target.avg_tokens =
          target.count > 0 ? Math.round(target.total_tokens / target.count) : 0;
      }
    }

    aggregated.tips.push(...(sessionTokens.tips || []));
    if (sessionTokens.last_summary) {
      aggregated.last_summary = sessionTokens.last_summary;
    }
  }

  // Sort runs by date
  aggregated.runs.sort((a, b) => {
    const da = new Date(a.completed_at || a.started_at || 0).getTime();
    const db = new Date(b.completed_at || b.started_at || 0).getTime();
    return da - db;
  });

  // Cap runs
  if (aggregated.runs.length > TOKEN_HISTORY_MAX_RUNS) {
    aggregated.runs = aggregated.runs.slice(-TOKEN_HISTORY_MAX_RUNS);
  }

  // Cap tips
  if (aggregated.tips.length > TOKEN_TIPS_MAX) {
    aggregated.tips = aggregated.tips.slice(-TOKEN_TIPS_MAX);
  }

  return aggregated;
}

function saveTokenState(ts, sessionId) {
  const session = sessionId || getSessionId();
  const tokensPath = resolveStatePath(TOKENS_PATH);
  const fullState = migrateToSessions(readJsonSafe(tokensPath, { version: 1, sessions: {} }));

  if (!fullState.sessions) fullState.sessions = {};
  if (!fullState.sessions[session]) {
    fullState.sessions[session] = { ...DEFAULT_SESSION_TOKENS };
  }

  const target = fullState.sessions[session];
  target.runs = (ts.runs || []).slice(-TOKEN_HISTORY_MAX_RUNS);
  target.aggregates = ts.aggregates || { ...DEFAULT_SESSION_TOKENS.aggregates };
  target.tips = (ts.tips || []).slice(-TOKEN_TIPS_MAX);
  target.last_summary = ts.last_summary || null;

  writeJson(tokensPath, fullState);
}

function initRunTokens(state) {
  state.tokens = {
    run_id: `run-${Date.now().toString(36)}`,
    started_at: state.started_at || new Date().toISOString(),
    phases: [],
    total_estimated: 0,
    total_reported: 0,
    total_cache_read: 0,
    source: "estimated",
  };
}

function getLastPhaseDurationMs(state) {
  const history = state.lifecycle?.phase_history;
  if (!history?.length) return null;
  const last = history[history.length - 1];
  return last.duration_ms ?? null;
}

function resolveAgentBudget(subagentType, state) {
  const cfg = state?.orchestraConfig?.token_budgets;
  if (cfg) {
    const map = {
      "orchestra-planner": cfg.planner,
      "orchestra-implementer": cfg.implementer,
      "orchestra-verifier": cfg.verifier,
      "orchestra-reviewer": cfg.reviewer,
    };
    if (map[subagentType] != null) return map[subagentType];
  }
  return AGENT_BUDGETS[subagentType] ?? null;
}

function resolveCycleBudget(state) {
  return state?.orchestraConfig?.token_budgets?.cycle ?? CYCLE_BUDGET;
}

/**
 * Record token usage for one completed subagent phase.
 * Uses reported API usage when present; otherwise estimates from output text length.
 */
function recordPhaseTokens(state, input, subagentType) {
  if (!state.active) return null;
  if (!state.tokens) initRunTokens(state);

  const outputText = extractOutputText(input);
  const reported = extractReportedUsage(input);
  const outputEst = estimateTokens(outputText);
  const phaseTokens = reported?.total_tokens > 0 ? reported.total_tokens : outputEst;
  const budget = resolveAgentBudget(subagentType, state);
  const durationMs = getLastPhaseDurationMs(state);
  const cacheRead = reported ? reported.cache_read_tokens || 0 : 0;
  const cacheDenom = cacheRead + (reported ? reported.prompt_tokens || 0 : 0);

  const entry = {
    phase: state.currentPhase,
    agent: subagentType,
    timestamp: new Date().toISOString(),
    duration_ms: durationMs,
    output_chars: outputText.length,
    estimated_tokens: phaseTokens,
    reported: reported || null,
    cache_read_tokens: cacheRead,
    cache_hit_rate: cacheDenom > 0 ? Math.round((cacheRead / cacheDenom) * 100) : null,
    over_budget: budget != null ? phaseTokens > budget : null,
    budget,
  };

  state.tokens.phases.push(entry);
  state.tokens.total_estimated += phaseTokens;
  state.tokens.total_cache_read = (state.tokens.total_cache_read || 0) + cacheRead;
  if (reported?.total_tokens > 0) {
    state.tokens.total_reported += reported.total_tokens;
    state.tokens.source = "mixed";
  }

  return entry;
}

function bumpAggregate(agg, key, bucket, tokens, overBudget) {
  if (!agg[bucket][key]) {
    agg[bucket][key] = { count: 0, total_tokens: 0, over_budget: 0, avg_tokens: 0 };
  }
  const row = agg[bucket][key];
  row.count++;
  row.total_tokens += tokens;
  if (overBudget) row.over_budget++;
  row.avg_tokens = Math.round(row.total_tokens / row.count);
}

function generateImprovementTips(run, aggregates, priorRuns, cycleBudget) {
  const tips = [];
  const phases = run.phases || [];
  const budget = cycleBudget ?? CYCLE_BUDGET;

  for (const p of phases) {
    if (p.over_budget && p.budget) {
      const overPct = Math.round(((p.estimated_tokens - p.budget) / p.budget) * 100);
      tips.push({
        priority: "high",
        agent: p.agent,
        phase: p.phase,
        message: `${p.agent} used ~${p.estimated_tokens.toLocaleString()} tokens (${overPct}% over ${p.budget.toLocaleString()} budget). Trim tool output and avoid full-file reads.`,
        action: agentTipAction(p.agent),
      });
    }
  }

  if (run.total_estimated > budget) {
    const overPct = Math.round(((run.total_estimated - budget) / budget) * 100);
    tips.push({
      priority: "high",
      agent: null,
      phase: "cycle",
      message: `Cycle total ~${run.total_estimated.toLocaleString()} tokens (${overPct}% over ${budget.toLocaleString()} cycle budget).`,
      action: "Route read-only phases to cheaper models; enable OpenCode compaction.prune.",
    });
  }

  const impl = phases.filter((p) => p.agent === "orchestra-implementer");
  if (impl.length > 0) {
    const implAvg = impl.reduce((s, p) => s + p.estimated_tokens, 0) / impl.length;
    const aggImpl = aggregates.by_agent?.["orchestra-implementer"];
    if (aggImpl && aggImpl.count >= 3 && implAvg > aggImpl.avg_tokens * 1.25) {
      tips.push({
        priority: "medium",
        agent: "orchestra-implementer",
        phase: "implement",
        message: `Implementer spike: ~${Math.round(implAvg).toLocaleString()} tokens vs rolling avg ${aggImpl.avg_tokens.toLocaleString()}.`,
        action: "Grep with head_limit before reads; batch parallel file reads; no exploratory web search.",
      });
    }
  }

  if (priorRuns.length >= 2) {
    const recent = priorRuns.slice(-5);
    const avg = recent.reduce((s, r) => s + (r.total_estimated || 0), 0) / recent.length;
    if (run.total_estimated > avg * 1.2) {
      tips.push({
        priority: "medium",
        agent: null,
        phase: "trend",
        message: `This run (~${run.total_estimated.toLocaleString()}) is ${Math.round(((run.total_estimated - avg) / avg) * 100)}% above your recent 5-run average (~${Math.round(avg).toLocaleString()}).`,
        action: "Review docs/token-optimization.md checklist; run orchestra-enable.js tokens.",
      });
    } else if (run.total_estimated < avg * 0.85) {
      tips.push({
        priority: "low",
        agent: null,
        phase: "trend",
        message: `Efficient run: ~${Math.round(((avg - run.total_estimated) / avg) * 100)}% below recent average.`,
        action: "Keep current tool discipline.",
      });
    }
  }

  if (run.iterations > 4) {
    tips.push({
      priority: "medium",
      agent: null,
      phase: "iterations",
      message: `${run.iterations} iterations — each FIX_REQUIRED loop adds implement+verify+review tokens.`,
      action: "Tighten planner done-when criteria; fix blockers in one implement pass.",
    });
  }

  if (run.cache_hit_rate != null && run.cache_hit_rate > 0 && run.cache_hit_rate < 40) {
    tips.push({
      priority: "medium",
      agent: null,
      phase: "cache",
      message: `Prompt cache hit rate ${run.cache_hit_rate}% — the injected prefix is churning and paying full input price.`,
      action: "Keep injection cache-shaped: static context first, volatile state last (docs/token-optimization.md §2.5).",
    });
  }

  return tips;
}

function agentTipAction(agent) {
  const map = {
    "orchestra-planner":
      "Grep/glob with head_limit; no web search; plan under 100 lines.",
    "orchestra-implementer":
      "Read function scope only; one web query max if plan requires external docs.",
    "orchestra-verifier":
      "One-line failure summaries; no full log paste.",
    "orchestra-reviewer":
      "Review git diff only; no re-reads or re-tests.",
  };
  return map[agent] || "See docs/token-optimization.md.";
}

function finalizeRunTokens(state, outcome, sessionId) {
  if (!state.tokens?.phases?.length) return null;

  const cycleBudget = resolveCycleBudget(state);

  const fullState = loadTokenState(sessionId);
  const session = sessionId || getSessionId();
  const sessionTokens = fullState.sessions[session] || { ...DEFAULT_SESSION_TOKENS };

  const run = {
    run_id: state.tokens.run_id,
    goal: (state.goal || "").slice(0, 200),
    outcome: outcome || "completed",
    loop_mode: state.loopMode || "core",
    started_at: state.tokens.started_at,
    completed_at: new Date().toISOString(),
    iterations: state.iteration || 0,
    phases: state.tokens.phases,
    total_estimated: state.tokens.total_estimated,
    total_reported: state.tokens.total_reported || 0,
    source: state.tokens.source,
    over_cycle_budget: state.tokens.total_estimated > cycleBudget,
    cycle_budget: cycleBudget,
  };

  const reportedPromptTotal = run.phases.reduce(
    (s, p) => s + (p.reported?.prompt_tokens || 0),
    0
  );
  const cacheReadTotal = state.tokens.total_cache_read || 0;

  const runRecord = Object.assign(run, {
    host: state.host || null,
    cache_read_tokens: cacheReadTotal,
    cache_hit_rate:
      cacheReadTotal + reportedPromptTotal > 0
        ? Math.round((cacheReadTotal / (cacheReadTotal + reportedPromptTotal)) * 100)
        : null,
  });

  const tips = generateImprovementTips(
    runRecord,
    sessionTokens.aggregates,
    sessionTokens.runs,
    cycleBudget
  );
  runRecord.tips = tips;

  sessionTokens.runs.push(runRecord);
  sessionTokens.aggregates.total_runs++;
  sessionTokens.aggregates.total_tokens_estimated += runRecord.total_estimated;
  sessionTokens.aggregates.total_tokens_reported += runRecord.total_reported;
  sessionTokens.aggregates.total_cache_read =
    (sessionTokens.aggregates.total_cache_read || 0) + cacheReadTotal;

  for (const p of run.phases) {
    bumpAggregate(
      sessionTokens.aggregates,
      p.agent,
      "by_agent",
      p.estimated_tokens,
      p.over_budget
    );
    if (p.phase) {
      bumpAggregate(
        sessionTokens.aggregates,
        p.phase,
        "by_phase",
        p.estimated_tokens,
        p.over_budget
      );
    }
  }

  const stamped = new Date().toISOString();
  for (const tip of tips) {
    sessionTokens.tips.push({ ...tip, run_id: run.run_id, generated_at: stamped });
  }

  sessionTokens.last_summary = formatRunSummary(run, tips);
  saveTokenState(sessionTokens, session);

  state.tokens.last_finalized = {
    run_id: run.run_id,
    total_estimated: run.total_estimated,
    tips_count: tips.length,
  };

  return { run, tips, summary: sessionTokens.last_summary };
}

function formatRunSummary(run, tips) {
  const lines = [
    `Token usage — ${run.outcome}: ~${run.total_estimated.toLocaleString()} tokens (budget ${CYCLE_BUDGET.toLocaleString()})`,
  ];
  if (run.total_reported > 0) {
    lines.push(`  Reported API total: ${run.total_reported.toLocaleString()}`);
  }
  if (run.cache_read_tokens > 0) {
    lines.push(
      `  Prompt cache reads: ${run.cache_read_tokens.toLocaleString()} tokens` +
        (run.cache_hit_rate != null ? ` (${run.cache_hit_rate}% of input served from cache)` : "")
    );
  }
  for (const p of run.phases) {
    const flag = p.over_budget ? " ⚠ over budget" : "";
    lines.push(
      `  ${p.agent}: ~${p.estimated_tokens.toLocaleString()}${p.budget ? ` / ${p.budget.toLocaleString()}` : ""}${flag}`
    );
  }
  if (tips.length > 0) {
    lines.push("Improvements for next run:");
    for (const t of tips.slice(0, 5)) {
      lines.push(`  [${t.priority}] ${t.message}`);
      lines.push(`    → ${t.action}`);
    }
  }
  return lines.join("\n");
}

function buildTokenContextForSession(sessionId) {
  const fullState = loadTokenState(sessionId);
  const aggregated = getAggregatedTokenState(fullState);
  if (aggregated.runs.length === 0) return "";

  const recent = aggregated.runs.slice(-TOKEN_CONTEXT_RUNS);
  const avg =
    recent.reduce((s, r) => s + (r.total_estimated || 0), 0) / recent.length;
  const last = aggregated.runs[aggregated.runs.length - 1];

  const lines = [
    "Token usage tracker (orchestra-tokens.json):",
    `Last run: ~${(last.total_estimated || 0).toLocaleString()} tokens (${last.outcome})`,
    `Recent ${recent.length}-run avg: ~${Math.round(avg).toLocaleString()} (cycle budget ${CYCLE_BUDGET.toLocaleString()})`,
  ];
  if (last.cache_hit_rate != null) {
    lines.push(
      `Last run prompt-cache hit rate: ${last.cache_hit_rate}% — keep the stable prefix first, volatile content last.`
    );
  }

  const hotAgents = Object.entries(aggregated.aggregates.by_agent || {})
    .sort((a, b) => b[1].avg_tokens - a[1].avg_tokens)
    .slice(0, 2);
  if (hotAgents.length > 0) {
    lines.push(
      "Hotspots: " +
        hotAgents.map(([a, v]) => `${a} avg ~${v.avg_tokens.toLocaleString()}`).join(", ")
    );
  }

  const latestTips = (aggregated.tips || []).slice(-3);
  if (latestTips.length > 0) {
    lines.push("Apply next run:");
    for (const t of latestTips) {
      lines.push(`  - ${t.action || t.message}`);
    }
  }

  lines.push("CLI: node ~/.cursor/hooks/orchestra-enable.js tokens");
  return lines.join("\n");
}

function printTokenReport(sessionId) {
  const fullState = loadTokenState(sessionId);
  const aggregated = getAggregatedTokenState(fullState);
  console.log("=== Orchestra Token Usage ===\n");

  if (aggregated.runs.length === 0) {
    console.log("No token data yet. Complete an orchestra cycle to start tracking.");
    console.log("\nBudgets: planner 10k, implementer 30k, verifier 15k, reviewer 8k (63k/cycle)");
    return;
  }

  const agg = aggregated.aggregates;
  console.log(`Runs tracked: ${agg.total_runs}`);
  console.log(
    `All-time estimated: ~${agg.total_tokens_estimated.toLocaleString()} tokens` +
      (agg.total_tokens_reported > 0
        ? ` (reported: ${agg.total_tokens_reported.toLocaleString()})`
        : "")
  );
  console.log(`Cycle budget: ${CYCLE_BUDGET.toLocaleString()} tokens\n`);

  console.log("--- By agent (rolling) ---");
  for (const [agent, row] of Object.entries(agg.by_agent || {}).sort(
    (a, b) => b[1].total_tokens - a[1].total_tokens
  )) {
    const budget = AGENT_BUDGETS[agent];
    console.log(
      `  ${agent}: ${row.count} phases, avg ~${row.avg_tokens.toLocaleString()}` +
        (budget ? ` (budget ${budget.toLocaleString()})` : "") +
        (row.over_budget > 0 ? `, ${row.over_budget} over budget` : "")
    );
  }

  console.log("\n--- Recent runs ---");
  for (const run of aggregated.runs.slice(-5)) {
    const flag = run.over_cycle_budget ? " OVER" : "";
    console.log(
      `  ${run.completed_at?.slice(0, 19) || "?"} | ~${run.total_estimated.toLocaleString()}${flag} | ${run.outcome} | "${(run.goal || "").slice(0, 50)}"`
    );
  }

  if (aggregated.last_summary) {
    console.log("\n--- Last run summary ---\n" + aggregated.last_summary);
  }

  const openTips = (aggregated.tips || []).slice(-5);
  if (openTips.length > 0) {
    console.log("\n--- Tips for next run ---");
    for (const t of openTips) {
      console.log(`  [${t.priority}] ${t.message}`);
      console.log(`    → ${t.action}`);
    }
  }
}

function getSessionTokenState(tokenState, sessionId) {
  const session = sessionId || getSessionId();
  if (!tokenState.sessions) return { ...DEFAULT_SESSION_TOKENS };
  return tokenState.sessions[session] || { ...DEFAULT_SESSION_TOKENS };
}

module.exports = {
  TOKENS_PATH,
  AGENT_BUDGETS,
  CYCLE_BUDGET,
  DEFAULT_SESSION_TOKENS,
  DEFAULT_TOKEN_STATE,
  getSessionId,
  estimateTokens,
  extractOutputText,
  extractReportedUsage,
  loadTokenState,
  saveTokenState,
  initRunTokens,
  recordPhaseTokens,
  finalizeRunTokens,
  generateImprovementTips,
  buildTokenContextForSession,
  formatRunSummary,
  printTokenReport,
  getAggregatedTokenState,
  getSessionTokenState,
  migrateToSessions,
};
