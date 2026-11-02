// bundle/hooks/lib/context-detector.js
// Rebuilt after interruption (bundle/hooks/lib repair).
// Keeps first 96 lines valid; appends missing middle functions + module.exports.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SELECTIVE_INJECTION_PATH = path.resolve('context/selective-injection.json');
const CONTEXT_DIR = path.resolve('context');
const ARCHIVE_DIR = path.resolve('docs/archive');

const DEFAULT_BUDGET_MAP = {
  plan: 2000,
  implement: 2000,
  verify: 2000,
  review: 2000,
};

const SELECTIVE_LOAD_KEYS = ['load', 'skip', 'phase_pointer_only', 'budget_tokens'];

function safeRead(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    return '';
  }
}

function safeParse(p) {
  try {
    let raw = fs.readFileSync(p, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function fileFingerprint(p) {
  const raw = safeRead(p);
  if (!raw) return '';
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

function buildLegacyContextInjection(args) {
  args = args || {};
  const legacy = {
    version: 'legacy-1.0',
    source: args.source || 'unknown',
    timestamp: args.timestamp || Date.now(),
    archive_preserved: true,
    slim_target: 'progress-tracker.md',
    archive_target: 'docs/archive/progress-tracker-2026-11-02.md',
    notes: 'Archive/slim completed (bfd7aef2); trading/live deferred.',
  };
  return legacy;
}

function buildContextInjection(targetFile, phase, options) {
  options = options || {};
  const fingerprint = computeContextFingerprint(targetFile);
  const index = loadContextIndex();
  const budget = options.budget || (index && index.budget_tokens ? index.budget_tokens[phase] : DEFAULT_BUDGET_MAP[phase] || 2000);
  const injection = {
    target: targetFile,
    phase: phase || 'implement',
    fingerprint: fingerprint,
    budget_tokens: budget,
    selective_load: index ? index.load || [] : ['context/progress-tracker.md', 'context/architecture.md', 'docs/index.md'],
    selective_skip: index ? index.skip || ['docs/archive/progress-tracker-2026-11-02.md', 'docs/archive/architecture-historical-2026-11-02.md'] : [],
    archive_preserved: true,
    truncated: false,
    truncated_at: null,
    built_at: Date.now(),
    source: options.source || 'bundle/hooks/lib/context-detector.js',
  };
  return injection;
}

function computeContextFingerprint(targetFile) {
  if (!targetFile) return '';
  if (Array.isArray(targetFile)) {
    const combined = targetFile.map(f => fileFingerprint(f)).join('|');
    return crypto.createHash('sha256').update(combined).digest('hex').slice(0, 16);
  }
  return fileFingerprint(targetFile);
}

function loadContextIndex() {
  const meta = safeParse(SELECTIVE_INJECTION_PATH);
  if (meta && meta.load) {
    return meta;
  }
  return {
    load: ['context/progress-tracker.md', 'context/architecture.md', 'docs/index.md'],
    skip: ['docs/archive/progress-tracker-2026-11-02.md', 'docs/archive/architecture-historical-2026-11-02.md'],
    phase_pointer_only: 'progress-tracker.md',
    budget_tokens: DEFAULT_BUDGET_MAP,
  };
}

function loadContextFingerprint(key) {
  key = key || 'default';
  const fpPath = path.resolve('context/.fingerprint-' + key);
  return safeRead(fpPath).trim();
}

function saveContextFingerprint(key, fingerprint) {
  key = key || 'default';
  const fpPath = path.resolve('context/.fingerprint-' + key);
  fs.writeFileSync(fpPath, fingerprint || '', 'utf8');
}

function estimateTokens(text) {
  if (!text) return 0;
  // Rough token estimate: ~0.75 tokens per word; split on whitespace.
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 0.75);
}

function truncateToBudget(text, budget) {
  budget = budget || 2000;
  if (!text) return { text: '', truncated: true, truncated_at: 0, remaining: budget };
  const tokens = estimateTokens(text);
  if (tokens <= budget) {
    return { text: text, truncated: false, truncated_at: null, remaining: budget - tokens };
  }
  // Truncate by splitting on sentences; keep full sentences within budget.
  const sentences = text.split(/(?<=[.!?])\s+/);
  let kept = '';
  let count = 0;
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const sentenceTokens = estimateTokens(sentence);
    if (count + sentenceTokens <= budget) {
      kept += (kept ? ' ' : '') + sentence;
      count += sentenceTokens;
    } else {
      break;
    }
  }
  if (kept.length < text.length) {
    return { text: kept.trim(), truncated: true, truncated_at: kept.length, remaining: budget - count };
  }
  return { text: text, truncated: false, truncated_at: null, remaining: budget - count };
}

function loadSelectiveInjection() {
  return safeParse(SELECTIVE_INJECTION_PATH) || {};
}

function wireSelectiveInjection() {
  const data = loadSelectiveInjection();
  return {
    loaded: true,
    path: SELECTIVE_INJECTION_PATH,
    load: data.load || [],
    skip: data.skip || [],
    budget_tokens: data.budget_tokens || DEFAULT_BUDGET_MAP,
  };
}

// Static context blocks for prompt-cache safety (no timestamps, UUIDs, run/session ids).
// These are intentionally stable across sessions so prompt-cache providers can
// discount the prefix (OpenAI cached-input pricing; Anthropic cache_control ~90% off).
// Volatile state (memory, tokens, crash state) goes into the dynamic tail only.

const AMBIENT_CONTEXT = [
  "P-Core Orchestra — ambient session context",
  "Phase-driven orchestration: plan → implement → verify → review",
  "Six-file context invariant: project-overview, architecture, code-standards, ui-context, ai-workflow-rules, progress-tracker",
  "Repo-scoped: each subfolder owns its git history and context metadata",
  "Bridge-backed single brain (:41794) with per-service Bearer auth",
  "Free-model pool: nemotron-3.5-lightning-free, big-pickle, mimo-v2.5-free, hy3-free, muse-spark-1.2-contributor-free",
].join("\n");

const PARENT_HANDOFF_CONTEXT = [
  "Parent/previous session handoff — if resuming, goal and mode persist",
  "Loop mode: core (plan→implement→verify→review) or enterprise (tech-lead/breaker/qa/release)",
  "Last completed phase recorded in long-term memory; checkpoint saved on interrupt",
  "Resume: say 'resume orchestra' or 'continue orchestra' to recommence from checkpoint",
  "Discard: say 'stop orchestra' or 'new goal' to start fresh",
  "Handoff guard: no code edits in plan phase; planner outputs PLAN_READY before implement",
].join("\n");

module.exports = {
  buildContextInjection: buildContextInjection,
  computeContextFingerprint: computeContextFingerprint,
  loadContextIndex: loadContextIndex,
  loadContextFingerprint: loadContextFingerprint,
  saveContextFingerprint: saveContextFingerprint,
  estimateTokens: estimateTokens,
  truncateToBudget: truncateToBudget,
  buildLegacyContextInjection: buildLegacyContextInjection,
  loadSelectiveInjection: loadSelectiveInjection,
  wireSelectiveInjection: wireSelectiveInjection,
  AMBIENT_CONTEXT: AMBIENT_CONTEXT,
  PARENT_HANDOFF_CONTEXT: PARENT_HANDOFF_CONTEXT,
};
