"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  TOKEN_HISTORY_MAX_RUNS,
  TOKEN_TIPS_MAX,
  TOKEN_CONTEXT_RUNS,
} = require("./constants.js");

const TOKENS_PATH = path.join(__dirname, "..", "state", "orchestra-tokens.json");

/** Per-agent design budgets (see docs/token-optimization.md). */
const AGENT_BUDGETS = {
  "orchestra-planner": 10000,
  "orchestra-implementer": 30000,
  "orchestra-verifier": 15000,
  "orchestra-reviewer": 8000,
};

const CYCLE_BUDGET = 63000;

const DEFAULT_TOKEN_STATE = {
  version: 1,
  runs: [],
  aggregates: {
    total_runs: 0,
    total_tokens_estimated: 0,
    total_tokens_reported: 0,
    by_agent: {},
    by_phase: {},
  },
  tips: [],
  last_summary: null,
};

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
      usage.completion_tokens ?? usage.output_tokens ?? usage.completionTokens ?? null;
    let total = usage.total_tokens ?? usage.totalTokens ?? null;
    if (total == null && prompt != null && completion != null) {
      total = prompt + completion;
    }
    if (prompt != null || completion != null || total != null) {
      return {
        prompt_tokens: prompt ?? 0,
        completion_tokens: completion ?? 0,
        total_tokens: total ?? 0,
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
      source: "reported",
    };
  }

  return null;
}

function loadTokenState() {
  try {
    if (!fs.existsSync(TOKENS_PATH)) {
      return {
        ...DEFAULT_TOKEN_STATE,
        runs: [],
        aggregates: { ...DEFAULT_TOKEN_STATE.aggregates, by_agent: {}, by_phase: {} },
        tips: [],
      };
    }
    const raw = JSON.parse(fs.readFileSync(TOKENS_PATH, "utf8"));
    return {
      ...DEFAULT_TOKEN_STATE,
      ...raw,
      aggregates: { ...DEFAULT_TOKEN_STATE.aggregates, ...raw.aggregates },
      runs: raw.runs || [],
      tips: raw.tips || [],
    };
  } catch {
    return {
      ...DEFAULT_TOKEN_STATE,
      runs: [],
      aggregates: { ...DEFAULT_TOKEN_STATE.aggregates, by_agent: {}, by_phase: {} },
      tips: [],
    };
  }
}

function saveTokenState(ts) {
  fs.mkdirSync(path.dirname(TOKENS_PATH), { recursive: true });
  if (ts.runs.length > TOKEN_HISTORY_MAX_RUNS) {
    ts.runs = ts.runs.slice(-TOKEN_HISTORY_MAX_RUNS);
  }
  if (ts.tips.length > TOKEN_TIPS_MAX) {
    ts.tips = ts.tips.slice(-TOKEN_TIPS_MAX);
  }
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(ts, null, 2));
}

function initRunTokens(state) {
  state.tokens = {
    run_id: `run-${Date.now().toString(36)}`,
    started_at: state.started_at || new Date().toISOString(),
    phases: [],
    total_estimated: 0,
    total_reported: 0,
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

  const entry = {
    phase: state.currentPhase,
    agent: subagentType,
    timestamp: new Date().toISOString(),
    duration_ms: durationMs,
    output_chars: outputText.length,
    estimated_tokens: phaseTokens,
    reported: reported || null,
    over_budget: budget != null ? phaseTokens > budget : null,
    budget,
  };

  state.tokens.phases.push(entry);
  state.tokens.total_estimated += phaseTokens;
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

function finalizeRunTokens(state, outcome) {
  if (!state.tokens?.phases?.length) return null;

  const cycleBudget = resolveCycleBudget(state);

  const ts = loadTokenState();
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

  const tips = generateImprovementTips(run, ts.aggregates, ts.runs, cycleBudget);
  run.tips = tips;

  ts.runs.push(run);
  ts.aggregates.total_runs++;
  ts.aggregates.total_tokens_estimated += run.total_estimated;
  ts.aggregates.total_tokens_reported += run.total_reported;

  for (const p of run.phases) {
    bumpAggregate(ts.aggregates, p.agent, "by_agent", p.estimated_tokens, p.over_budget);
    if (p.phase) {
      bumpAggregate(ts.aggregates, p.phase, "by_phase", p.estimated_tokens, p.over_budget);
    }
  }

  const stamped = new Date().toISOString();
  for (const tip of tips) {
    ts.tips.push({ ...tip, run_id: run.run_id, generated_at: stamped });
  }

  ts.last_summary = formatRunSummary(run, tips);
  saveTokenState(ts);

  state.tokens.last_finalized = {
    run_id: run.run_id,
    total_estimated: run.total_estimated,
    tips_count: tips.length,
  };

  return { run, tips, summary: ts.last_summary };
}

function formatRunSummary(run, tips) {
  const lines = [
    `Token usage — ${run.outcome}: ~${run.total_estimated.toLocaleString()} tokens (budget ${CYCLE_BUDGET.toLocaleString()})`,
  ];
  if (run.total_reported > 0) {
    lines.push(`  Reported API total: ${run.total_reported.toLocaleString()}`);
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

function buildTokenContextForSession() {
  const ts = loadTokenState();
  if (ts.runs.length === 0) return "";

  const recent = ts.runs.slice(-TOKEN_CONTEXT_RUNS);
  const avg =
    recent.reduce((s, r) => s + (r.total_estimated || 0), 0) / recent.length;
  const last = ts.runs[ts.runs.length - 1];

  const lines = [
    "Token usage tracker (orchestra-tokens.json):",
    `Last run: ~${(last.total_estimated || 0).toLocaleString()} tokens (${last.outcome})`,
    `Recent ${recent.length}-run avg: ~${Math.round(avg).toLocaleString()} (cycle budget ${CYCLE_BUDGET.toLocaleString()})`,
  ];

  const hotAgents = Object.entries(ts.aggregates.by_agent || {})
    .sort((a, b) => b[1].avg_tokens - a[1].avg_tokens)
    .slice(0, 2);
  if (hotAgents.length > 0) {
    lines.push(
      "Hotspots: " +
        hotAgents.map(([a, v]) => `${a} avg ~${v.avg_tokens.toLocaleString()}`).join(", ")
    );
  }

  const latestTips = (ts.tips || []).slice(-3);
  if (latestTips.length > 0) {
    lines.push("Apply next run:");
    for (const t of latestTips) {
      lines.push(`  - ${t.action || t.message}`);
    }
  }

  lines.push("CLI: node ~/.cursor/hooks/orchestra-enable.js tokens");
  return lines.join("\n");
}

function printTokenReport() {
  const ts = loadTokenState();
  console.log("=== Orchestra Token Usage ===\n");

  if (ts.runs.length === 0) {
    console.log("No token data yet. Complete an orchestra cycle to start tracking.");
    console.log("\nBudgets: planner 10k, implementer 30k, verifier 15k, reviewer 8k (63k/cycle)");
    return;
  }

  const agg = ts.aggregates;
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
  for (const run of ts.runs.slice(-5)) {
    const flag = run.over_cycle_budget ? " OVER" : "";
    console.log(
      `  ${run.completed_at?.slice(0, 19) || "?"} | ~${run.total_estimated.toLocaleString()}${flag} | ${run.outcome} | "${(run.goal || "").slice(0, 50)}"`
    );
  }

  if (ts.last_summary) {
    console.log("\n--- Last run summary ---\n" + ts.last_summary);
  }

  const openTips = (ts.tips || []).slice(-5);
  if (openTips.length > 0) {
    console.log("\n--- Tips for next run ---");
    for (const t of openTips) {
      console.log(`  [${t.priority}] ${t.message}`);
      console.log(`    → ${t.action}`);
    }
  }
}

module.exports = {
  TOKENS_PATH,
  AGENT_BUDGETS,
  CYCLE_BUDGET,
  DEFAULT_TOKEN_STATE,
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
};
