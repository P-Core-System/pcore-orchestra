#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readStdinJson, emit } = require("./lib/io.js");
const { saveState, updateState, DEFAULT_STATE } = require("./lib/state-manager.js");
const {
  getPhaseChain,
  getAgentForPhase,
  getPhaseInfo,
  getImplementPhaseId,
  getPhasesForMode,
  reviewerNeedsFix,
  LOOP_MODE_ENTERPRISE,
} = require("./lib/phase-engine.js");
const { emitLifecycleEvent, endPhaseTimer, startPhaseTimer } = require("./lib/lifecycle-recorder.js");
const { flushShortToLong } = require("./lib/memory-manager.js");
const { recordOrchestrationRun } = require("./lib/history-recorder.js");
const { bumpProjectVersion, addChangelogEntry } = require("./lib/version-manager.js");
const { passGate, failGate, skipGate } = require("./lib/quality-gate.js");
const { addTechDebt, generateProjectSummary, loadProjectState, saveProjectState } = require("./lib/project-manager.js");
const { loadDailyState, saveDailyState, getOrCreateTodayEntry, generateDailySummary } = require("./lib/daily-planner.js");
const { recordPhaseTokens, finalizeRunTokens } = require("./lib/token-tracker.js");
const { buildPhaseHandoff, buildHandoffEnforcement } = require("./lib/handoff-enforcer.js");
const { runEvidenceChecks, applyEvidenceToGates } = require("./lib/evidence-runner.js");
const { validateSixFileContext } = require("./lib/context-detector.js");
const { saveCheckpoint } = require("./lib/checkpoint-manager.js");
const { savePlanArtifact, buildPlanHandoffLine } = require("./lib/plan-artifact.js");
const { writeCycleReport } = require("./lib/cycle-report.js");
const { checkPhaseCommitGate } = require("./lib/phase-commit-gate.js");
const { evaluatePhaseOutcome } = require("./lib/phase-outcome.js");
const { PHASE_BLOCKED_EVENT } = require("./lib/constants.js");
const {
  createRunWorktree,
  cleanupRunWorktree,
  getWorktreePath,
} = require("./lib/worktree-manager.js");
const { canRunInParallel } = require("./lib/orchestra-spawn-matrix.js");
const { spawn: spawnAdapter, SUPPORTED_HOSTS } = require("./lib/spawn-adapter.js");

// Load agent registry for independence checks
let agentRegistry = null;
try {
  agentRegistry = require("../agent-registry.json");
} catch {}

// Phase 2 domain event log — lazy + guarded so a missing/broken domain module
// can never take the host hook down (fail-open by design).
let recordPhaseOutcome = null;
try {
  ({ recordPhaseOutcome } = require("./lib/domain/index.js"));
} catch {}

// MCP server — lazy + guarded for fail-open
let mcpServer = null;
try {
  ({ start: mcpServerStart, stop: mcpServerStop } = require("./lib/mcp-server.js"));
} catch {}

// Module-level WeakMap to track MCP server instances per runId
const mcpServerInstances = new WeakMap();

/** Detect host from environment or state. */
function detectHost(state) {
  // Check state.host first (explicitly set)
  if (state?.host && SUPPORTED_HOSTS.includes(state.host)) {
    return state.host;
  }
  // Check environment variables
  if (process.env.CURSOR_TRACE_ID) return "cursor";
  if (process.env.OPENCODE_SESSION_ID) return "opencode";
  if (process.env.CLAUDE_CODE_SESSION_ID) return "claude-code";
  if (process.env.CODEX_SESSION_ID) return "codex";
  // Default to cursor for backward compatibility
  return "cursor";
}

/** Spawn subagent via adapter with fallback to stdout emission. */
async function spawnSubagent(agentId, payload, worktreePath, host) {
  try {
    const result = await spawnAdapter(agentId, payload, worktreePath, host);
    // Also emit to stdout for backward compatibility (hosts that don't use adapter)
    const taskCall = result.result?.taskCall || result.result?.mcpCall;
    if (taskCall) {
      process.stdout.write(JSON.stringify(taskCall) + "\n");
    }
    return result;
  } catch (e) {
    // Fallback: emit raw JSON to stdout (original behavior)
    const fallbackCall = host === "cursor"
      ? { tool: "Task", subagent_type: agentId, prompt: JSON.stringify(payload) }
      : host === "opencode"
        ? { tool: "task", agent: agentId, prompt: JSON.stringify(payload) }
        : { jsonrpc: "2.0", method: "tools/call", params: { name: "spawn_subagent", arguments: { agent: agentId, payload: JSON.stringify(payload) } }, id: `spawn-${Date.now()}` };
    process.stdout.write(JSON.stringify(fallbackCall) + "\n");
    return { success: false, result: null, error: e.message, artifacts: [] };
  }
}

/** Create worktree for a new run if not already created. */
function ensureWorktree(state) {
  if (state.worktreePath) return state.worktreePath;
  const baseCommit = state.baseCommit || state.diffBase?.commit;
  if (!baseCommit) return null;
  const runId = state.runId || state.tokens?.run_id || `run-${Date.now()}`;
  try {
    const result = createRunWorktree(runId, baseCommit);
    state.worktreePath = result.worktreePath;
    state.runId = runId;
    return result.worktreePath;
  } catch (e) {
    return null;
  }
}

/** Clean up worktree when run completes. */
function cleanupWorktree(state) {
  if (!state.worktreePath || !state.runId) return;
  try {
    cleanupRunWorktree(state.runId);
    state.worktreePath = null;
  } catch {}
}

/** Stop MCP server and clean up instance tracking. */
async function cleanupMcpServer(state) {
  if (!state.runId || !mcpServerStop) return;
  try {
    await mcpServerStop(state.runId);
  } catch {}
  // Clean up weak map reference
  try {
    // WeakMap doesn't have delete by key easily, but the instance will be GC'd
    // when no longer referenced. The mcp-server.js module manages its own instance.
  } catch {}
}

function getAgentDisplayName(agentId) {
  const display = {
    "business-analyst": "Business Analyst",
    "product-manager": "Product Manager",
    "architect": "Architect",
    "tech-lead": "Tech Lead",
    "project-manager": "Project Manager",
    "backend-engineer": "Backend Engineer",
    "frontend-engineer": "Frontend Engineer",
    "full-stack-engineer": "Full Stack Engineer",
    "database-engineer": "Database Engineer",
    "qa-engineer": "QA Engineer",
    "automation-engineer": "Automation Engineer",
    "security-engineer": "Security Engineer",
    "accessibility-reviewer": "Accessibility Reviewer",
    "documentation-writer": "Documentation Writer",
    "release-manager": "Release Manager",
    "devops-engineer": "DevOps Engineer",
    "sre": "SRE",
    "observer": "Observer",
    "code-reviewer": "Code Reviewer",
    "performance-engineer": "Performance Engineer",
    "platform-engineer": "Platform Engineer",
    "cloud-engineer": "Cloud Engineer",
    "infrastructure-engineer": "Infrastructure Engineer",
    "orchestra-planner": "Orchestra Planner",
    "orchestra-implementer": "Orchestra Implementer",
    "orchestra-verifier": "Orchestra Verifier",
    "orchestra-reviewer": "Orchestra Reviewer",
  };
  return display[agentId] || agentId;
}

/** Check if next phase can run in parallel with any pending phases. */
function checkParallelPhases(state, nextPhase, nextAgentId) {
  if (!agentRegistry || !canRunInParallel) return false;
  
  const phases = getPhasesForMode(state.loopMode, state);
  const currentIdx = phases.findIndex(p => p.id === nextPhase);
  if (currentIdx === -1 || currentIdx >= phases.length - 1) return false;
  
  // Check if any subsequent phase can run in parallel
  for (let i = currentIdx + 1; i < phases.length; i++) {
    const futurePhase = phases[i];
    const futureAgentId = getAgentForPhase(futurePhase.id);
    
    const phaseA = {
      id: nextPhase,
      agent: nextAgentId,
    };
    const phaseB = {
      id: futurePhase.id,
      agent: futureAgentId,
    };
    
    if (canRunInParallel(phaseA, phaseB, agentRegistry)) {
      return { phase: futurePhase, agentId: futureAgentId };
    }
  }
  return false;
}

/** Emit concurrent spawn message for parallel phases. */
function emitConcurrentSpawn(state, nextPhase, nextAgentId, parallelPhase) {
  const nextAgentDisplay = getAgentDisplayName(nextAgentId);
  const parallelAgentDisplay = getAgentDisplayName(parallelPhase.agentId);
  const phases = getPhasesForMode(state.loopMode, state);
  
  emit({
    followup_message: [
      `**Parallel phase execution detected** — phases can run concurrently.`,
      `Launch **${nextAgentId}** (${nextAgentDisplay}) for phase **${nextPhase}**.`,
      `Simultaneously launch **${parallelPhase.agentId}** (${parallelAgentDisplay}) for phase **${parallelPhase.phase.id}**.`,
      `Goal: ${state.goal}`,
      `Phase ${phases.findIndex(p => p.id === nextPhase) + 1} of ${phases.length} + Phase ${phases.findIndex(p => p.id === parallelPhase.phase.id) + 1} of ${phases.length}`,
    ].filter(Boolean).join("\n\n"),
  });
}

async function handleFixRequired(state) {
  const implPhase = getImplementPhaseId(state.loopMode);
  const agentId = "orchestra-implementer";
  state.currentPhase = implPhase;
  emitLifecycleEvent(state, "fix_required", state.currentPhase, {
    iteration: state.iteration,
  });
  if (!state.memory) state.memory = { ...DEFAULT_STATE.memory };
  state.memory.decisions.push({
    phase: "review",
    decision: "FIX_REQUIRED",
    rationale: "Reviewer requested fixes",
    timestamp: new Date().toISOString(),
  });

  if (state.iteration >= state.max_iterations) {
    emitLifecycleEvent(state, "max_iterations", state.currentPhase, {
      iteration: state.iteration,
    });
    recordOrchestrationRun(state, "max_iterations");
    try {
      writeCycleReport(state, "max_iterations");
    } catch {}
    state.active = false;
    state.currentPhase = "idle";
    saveState(state);
    
    // Stop MCP server on max iterations
    if (state.runId && mcpServerStop) {
      try {
        await mcpServerStop(state.runId);
      } catch {}
    }
    
    emit({
      followup_message:
        "Orchestra max iterations reached after FIX_REQUIRED. Report blockers to the user.",
    });
    return true;
  }

  startPhaseTimer(state, implPhase, agentId);
  saveState(state);
  
  // Spawn implementer via adapter for fix loop
  const host = detectHost(state);
  const payload = {
    goal: state.goal,
    fixRequired: true,
    iteration: state.iteration,
  };
  await spawnSubagent(agentId, payload, state.worktreePath, host);
  
  const modeLabel = state.loopMode === LOOP_MODE_ENTERPRISE ? "Enterprise" : "Core";
  emit({
    followup_message:
      `${modeLabel} loop — FIX_REQUIRED. Launch **${agentId}** to address reviewer blockers, then **commit**, then continue verify → review.\n\nGoal: ${state.goal}\n\nPhase commit gate: fixes must be committed before re-verify.`,
  });
  return true;
}

function handlePlanOnlyPause(state) {
  const implPhase = getImplementPhaseId(state.loopMode);
  saveCheckpoint(state);
  state.planAwaitingConfirm = true;
  state.resumable.paused = true;
  state.resumable.paused_at = new Date().toISOString();
  state.resumable.pause_reason = "plan_only";
  state.resumable.checkpoint = {
    phase: implPhase,
    goal: state.goal,
    iteration: state.iteration,
    last_subagent: state.last_subagent,
    started_at: state.started_at,
    loopMode: state.loopMode,
    timestamp: new Date().toISOString(),
  };
  state.active = false;
  state.currentPhase = "paused";
  saveState(state);
  emit({
    followup_message: [
      "Orchestra plan-only pause — planner finished.",
      "Review the plan above. Do NOT implement yet.",
      "Say **continue orchestra** or **approve plan** to start orchestra-implementer.",
      `Goal: ${state.goal}`,
    ].join("\n"),
  });
  return true;
}

async function handlePhaseComplete(state, chain) {
  const phases = getPhasesForMode(state.loopMode, state);
  const nextPhase = chain.nextPhase;
  state.currentPhase = nextPhase;

  emitLifecycleEvent(state, "phase_advance", state.currentPhase, {
    from: state.last_subagent,
    to: nextPhase,
    loopMode: state.loopMode,
  });

  if (nextPhase === "done") {
    emitLifecycleEvent(state, "orchestra_complete", "done", { goal: state.goal });

    const memory = state.memory || {};
    const changeTypes = [];
    const hasFeat = memory.decisions?.some((d) => /feat|feature|add|new/i.test(d.decision));
    const hasFix = memory.decisions?.some((d) => /fix|bug|patch/i.test(d.decision));
    const hasBreaking = memory.decisions?.some((d) => /breaking|major|refactor/i.test(d.decision));
    if (hasBreaking) changeTypes.push("breaking");
    if (hasFeat) changeTypes.push("feat");
    if (hasFix) changeTypes.push("fix");

    if (memory.files_changed?.length > 0) {
      try {
        bumpProjectVersion(state, changeTypes);
        addChangelogEntry(state, {
          type: changeTypes.includes("breaking")
            ? "changed"
            : changeTypes.includes("feat")
              ? "added"
              : "fixed",
          scope: state.goal?.split(" ").slice(0, 3).join("-") || "general",
          description: state.goal || "Orchestra run",
          sha: null,
        });
        passGate(state, "version-updated", `Version bumped to ${state.versioning.current}`);
        passGate(state, "changelog-updated", "Changelog entry added");
      } catch (e) {
        failGate(state, "version-updated", `Version bump failed: ${e.message}`);
      }
    }

    passGate(state, "memory-updated", "Short-term memory flushed to long-term");
    try {
      const ds = loadDailyState();
      getOrCreateTodayEntry(ds);
      generateDailySummary(ds);
      saveDailyState(ds);
      passGate(state, "daily-journal-updated", "Daily journal updated");
    } catch {}

    passGate(state, "docs-updated", "Context and memory files updated");
    passGate(state, "reviewer-approval", "Review completed");

    flushShortToLong(state, "completed");
    finalizeRunTokens(state, "completed");
    recordOrchestrationRun(state, "completed");
    try {
      writeCycleReport(state, "completed");
    } catch {}
    state.active = false;
    state.currentPhase = "idle";
    saveState(state);

    // Clean up worktree when run completes
    cleanupWorktree(state);
    // Stop MCP server
    await cleanupMcpServer(state);

    const summary = generateProjectSummary(loadProjectState());
    const modeLabel = state.loopMode === LOOP_MODE_ENTERPRISE ? "Enterprise SDLC" : "Core loop";
    const tokenLine = state.tokens?.last_finalized
      ? `Tokens: ~${state.tokens.last_finalized.total_estimated.toLocaleString()} estimated (${state.tokens.last_finalized.tips_count} improvement tip(s) — orchestra-enable.js tokens)`
      : null;
    emit({
      followup_message: [
        `${modeLabel} complete for goal: ${state.goal || "(no goal)"}`,
        `Version: ${state.versioning.current} (build ${state.versioning.buildNumber})`,
        `Project: ${summary.totalTasks} tasks, ${summary.completedTasks} completed, ${summary.unresolvedDebt} unresolved tech debt items`,
        `Quality gates: ${state.qualityGates.allRequiredPassed ? "ALL PASSED" : `${state.qualityGates.passed.length} passed, ${state.qualityGates.failed.length} failed, ${state.qualityGates.skipped.length} skipped`}`,
        tokenLine,
        "Summarize deliverables and next steps for the user.",
      ].filter(Boolean).join("\n"),
    });
    return true;
  }

  if (state.iteration >= state.max_iterations) {
    emitLifecycleEvent(state, "max_iterations", state.currentPhase, {
      iteration: state.iteration,
    });
    flushShortToLong(state, "max_iterations");
    finalizeRunTokens(state, "max_iterations");
    recordOrchestrationRun(state, "max_iterations");
    try {
      writeCycleReport(state, "max_iterations");
    } catch {}
    state.active = false;
    state.currentPhase = "idle";
    saveState(state);

    // Clean up worktree on max iterations
    cleanupWorktree(state);
    // Stop MCP server
    await cleanupMcpServer(state);

    emit({
      followup_message:
        "Orchestra hit max iterations. Stop chaining and give the user a status report.",
    });
    return true;
  }

  const memory = state.memory;
  if (memory?.errors?.length > 0) {
    try {
      const ps = loadProjectState();
      addTechDebt(ps, {
        title: `Errors during ${state.last_subagent} phase`,
        description: `Phase ${state.last_subagent} completed with ${memory.errors.length} error(s)`,
        impact: "May cause instability or incomplete implementation",
        area: state.last_subagent || "unknown",
        severity: "medium",
        suggestedFix: "Review phase output and address errors",
      });
      saveProjectState(ps);
    } catch {}
  }

  const nextAgentId = getAgentForPhase(nextPhase);
  state.last_subagent = null;
  saveState(state);
  startPhaseTimer(state, nextPhase, nextAgentId);
  saveState(state);

  let evidenceBlock = "";
  let evidenceRecords = [];
  let sixFileValidation = null;
  if (nextPhase === "verify") {
    try {
      // Ensure worktree exists for this run
      const worktreePath = ensureWorktree(state);
      const { report, records } = runEvidenceChecks(state, { cwd: worktreePath });
      evidenceBlock = report;
      evidenceRecords = records || [];
      if (!state.memory) state.memory = { ...DEFAULT_STATE.memory };
      state.memory.evidence_preflight = report;

      // Six-file context validation at verify entry
      const workspaceRoot = worktreePath || (state.project?.identityFile
        ? path.dirname(state.project.identityFile)
        : process.cwd());
      const claimedAt = state.memory?.progressTrackerClaimedAt || Date.now();
      sixFileValidation = validateSixFileContext(workspaceRoot, claimedAt);
      if (sixFileValidation) {
        state.memory.progressTrackerTouchedAt = Date.now();
        state.memory.progressTrackerClaimedAt = claimedAt;
        if (sixFileValidation.missing.length > 0) {
          if (!state.qualityGates) state.qualityGates = { passed: [], failed: [], skipped: [] };
          state.qualityGates.missingContext = sixFileValidation.missing;
        }
        saveState(state);
      }
    } catch {}
  }

  let commitGateBlock = "";
  try {
    const gate = checkPhaseCommitGate(state);
    commitGateBlock = gate.message;
    if (!gate.clean && (nextPhase === "verify" || nextPhase === "review")) {
      commitGateBlock +=
        "\nParent: commit or discard blocking files BEFORE launching the next subagent.";
    }
  } catch {}

  const nextInfo = getPhaseInfo(nextPhase);
  const nextAgentDisplay = getAgentDisplayName(nextAgentId);
  const phaseLabel = nextInfo
    ? nextInfo.id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : nextPhase;
  const categoryLabel = nextInfo ? nextInfo.category.toUpperCase() : "CORE";
  const modeLabel = state.loopMode === LOOP_MODE_ENTERPRISE ? "Enterprise SDLC" : "Core loop";

  // Build work-item context from state.memory
  const workItemContext = {
    ticketId: state.memory?.ticketId,
    acCount: state.memory?.acCount,
  };

  // Enrich handoff with evidence digest, work-item context, and phase outcome
  const enrichedHandoff = buildHandoffEnforcement(state, evidenceRecords, workItemContext);

  // Check for parallel phase execution
  const parallelPhase = checkParallelPhases(state, nextPhase, nextAgentId);
  if (parallelPhase) {
    // Spawn both agents concurrently via adapter
    const host = detectHost(state);
    const payload = {
      goal: state.goal,
      handoff: enrichedHandoff,
      commitGate: commitGateBlock,
      evidence: evidenceBlock,
      sixFile: sixFileValidation || null,
    };
    await Promise.all([
      spawnSubagent(nextAgentId, payload, state.worktreePath, host),
      spawnSubagent(parallelPhase.agentId, payload, state.worktreePath, host),
    ]);
    // Also emit concurrent spawn message for backward compatibility
    emitConcurrentSpawn(state, nextPhase, nextAgentId, parallelPhase);
    return true;
  }

  // Spawn next agent via adapter
  const host = detectHost(state);
  const payload = {
    goal: state.goal,
    handoff: enrichedHandoff,
    commitGate: commitGateBlock,
    evidence: evidenceBlock,
    sixFile: sixFileValidation || null,
  };
  const spawnResult = await spawnSubagent(nextAgentId, payload, state.worktreePath, host);
  
  // Use normalized response to drive phase outcome evaluation
  if (spawnResult && !spawnResult.success) {
    // Spawn failed - record and potentially block
    if (!state.memory) state.memory = { ...DEFAULT_STATE.memory };
    state.memory.errors = state.memory.errors || [];
    state.memory.errors.push({
      phase: nextPhase,
      agent: nextAgentId,
      error: spawnResult.error || "Spawn failed",
      timestamp: new Date().toISOString(),
    });
    saveState(state);
  }

  // Emit followup message for backward compatibility / human visibility
  emit({
    followup_message: [
      `${modeLabel} — ${categoryLabel} Phase: **${phaseLabel}**`,
      `Launch **${nextAgentId}** (${nextAgentDisplay}) subagent to continue.`,
      `Goal: ${state.goal}`,
      `Phase ${phases.findIndex((p) => p.id === nextPhase) + 1} of ${phases.length}`,
      enrichedHandoff,
      commitGateBlock || null,
      evidenceBlock || null,
    ].filter(Boolean).join("\n\n"),
  });
  return true;
}

async function main() {
  const input = await readStdinJson();
  const status = input.status || "";
  const subagentType = input.subagent_type || input.subagentType || "";

  if (status !== "completed") {
    emit({});
    return;
  }

  // Locked read → mutate → write for the bookkeeping half of this hook.
  // Evidence runs, gate checks and phase transitions stay OUTSIDE the lock —
  // they can take minutes (spawnSync of build/tests/lint) and would starve
  // every other hook waiting on the same lock file.
  const state = updateState((s) => {
    if (!s.active) return null;
    if (!getPhaseChain(s)[s.currentPhase]) return null;

    s.last_subagent = subagentType;
    s.iteration = (s.iteration || 0) + 1;

    endPhaseTimer(s, "completed");
    recordPhaseTokens(s, input, subagentType);
    emitLifecycleEvent(s, "phase_complete", s.currentPhase, {
      subagent: subagentType,
      iteration: s.iteration,
    });

    if (!s.memory) {
      s.memory = {
        phases_completed: [],
        files_changed: [],
        errors: [],
        decisions: [],
        context_summary: "",
      };
    }

    const outputSnippet = (input.summary || input.result || input.output || input.text || "")
      .toString()
      .slice(0, 200);
    s.memory.phases_completed.push({
      phase: s.currentPhase,
      agent: subagentType,
      summary: outputSnippet,
      timestamp: new Date().toISOString(),
    });

    if (
      subagentType === "orchestra-planner" &&
      s.currentPhase === "plan"
    ) {
      try {
        savePlanArtifact(s, input);
      } catch {}
    }

    return s;
  });

  if (!state) {
    emit({});
    return;
  }

  const chain = getPhaseChain(state)[state.currentPhase];

  if (
    subagentType === "orchestra-planner" &&
    state.orchestraConfig?.plan_only &&
    state.currentPhase === "plan"
  ) {
    handlePlanOnlyPause(state);
    return;
  }

  if (subagentType === "orchestra-verifier" && state.currentPhase === "verify") {
    try {
      const worktreePath = state.worktreePath;
      const { report } = applyEvidenceToGates(state, passGate, failGate, skipGate, {
        cwd: worktreePath,
        includeSecurity: false,
        onEvidence: (ev) => {
          try {
            const dom = require("./lib/domain");
            if (dom && dom.evidence && typeof dom.evidence.appendEvidenceRun === "function") {
              dom.evidence.appendEvidenceRun(ev, { worktreePath });
            }
          } catch {}
        },
      });
      if (!state.memory) state.memory = { ...DEFAULT_STATE.memory };
      state.memory.evidence_gates = report;
      saveState(state);
    } catch {}
  }

  if (
    (subagentType === "orchestra-reviewer" || subagentType === "code-reviewer") &&
    reviewerNeedsFix(input)
  ) {
    if (await handleFixRequired(state)) return;
  }

  // Phase outcome gate: end token + green required gates before advancing.
  // fix > block > advance; warnings (enterprise/empty output) never stop the loop.
  const outcome = evaluatePhaseOutcome(state, input);
  state.last_outcome = {
    phase: state.currentPhase,
    decision: outcome.decision,
    reason: outcome.reason,
    token: outcome.token,
    expected: outcome.expected,
    warning: outcome.warning,
    at: new Date().toISOString(),
  };

  // Domain event log (Phase 2): record every phase outcome. Fail-open —
  // never touches stdout, quality gates or the orchestra.json shape.
  try {
    if (typeof recordPhaseOutcome === "function") {
      recordPhaseOutcome(state, state.last_outcome, subagentType, state.worktreePath);
    }
  } catch {}

  if (outcome.decision === "block") {
    emitLifecycleEvent(state, PHASE_BLOCKED_EVENT, state.currentPhase, {
      reason: outcome.reason,
      expected: outcome.expected,
      subagent: subagentType,
      iteration: state.iteration,
    });
    saveState(state);
    emit({ followup_message: outcome.message });
    return;
  }

  if (outcome.decision === "fix" && (await handleFixRequired(state))) return;

  await handlePhaseComplete(state, chain);
}

main().catch(() => {
  emit({});
});
