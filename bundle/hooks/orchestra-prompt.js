#!/usr/bin/env node
"use strict";

const { readStdinJson, emit } = require("./lib/io.js");
const { loadState, saveState, startOrchestra, getSessionId, getSessionState, setSessionState } = require("./lib/state-manager.js");
const { extractPrompt, classifyPrompt } = require("./lib/prompt-classifier.js");
const {
  detectContextInWorkspaces,
  buildContextInjection,
  detectProjectYamlInWorkspaces,
  AMBIENT_CONTEXT,
} = require("./lib/context-detector.js");
const { loadProjectIdentity } = require("./lib/project-identity.js");
const {
  extractOrchestraFromIdentity,
  mergeRoute,
  buildOrchestraConfigSummary,
} = require("./lib/orchestra-config.js");
const { buildPhaseHandoff, handoffWarningBlock } = require("./lib/handoff-enforcer.js");
const { syncWorkspaceIdentity } = require("./lib/workspace-identity.js");
const { buildGreenfieldIntakeBriefing } = require("./lib/greenfield-intake.js");
const { shouldAutoScaffold, buildScaffoldInstructionFromGoal } = require("./lib/greenfield-scaffold.js");
const { resumeOrchestra, detectCrashRecovery } = require("./lib/checkpoint-manager.js");
const { loadLongTermMemory, buildMemoryContext } = require("./lib/memory-manager.js");
const { getAgentForPhase, LOOP_MODE_ENTERPRISE } = require("./lib/phase-engine.js");

function handleDisable(state, sessionId) {
  const session = getSessionState(state, sessionId);
  session.ambient = false;
  session.active = false;
  session.currentPhase = "idle";
  setSessionState(state, session, sessionId);
  saveState(null, state, sessionId);
  emit({
    additional_context:
      "Orchestra ambient mode disabled for this machine. Re-enable: node ~/.cursor/hooks/orchestra-enable.js ambient-on",
  });
}

function handleEnable(state, sessionId) {
  const session = getSessionState(state, sessionId);
  session.ambient = true;
  setSessionState(state, session, sessionId);
  saveState(null, state, sessionId);
}

function agentForCheckpointPhase(phase) {
  return getAgentForPhase(phase) || "orchestra-planner";
}

function handleResume(state, input, sessionId) {
  const session = getSessionState(state, sessionId);
  const crash = detectCrashRecovery(session);
  if (session.active && crash) {
    session.active = false;
    session.currentPhase = "idle";
    session.resumable.paused = true;
    session.resumable.paused_at = new Date().toISOString();
    session.resumable.pause_reason = "crash_recovery";
    if (!session.resumable.checkpoint) {
      session.resumable.checkpoint = {
        phase: crash.phase,
        goal: crash.goal,
        iteration: crash.iteration,
        last_subagent: session.last_subagent,
        started_at: session.started_at,
        loopMode: session.loopMode,
        timestamp: new Date().toISOString(),
      };
    }
    setSessionState(state, session, sessionId);
    saveState(null, state, sessionId);
  }
  if (session.resumable?.paused && session.resumable?.checkpoint) {
    const cp = resumeOrchestra(session);
    if (cp) {
      const agent = agentForCheckpointPhase(cp.phase);
      emit({
        additional_context: [
          AMBIENT_CONTEXT,
          crash
            ? `Orchestra recovered from crash (was stuck at ${crash.last_activity}).`
            : `Orchestra RESUMED from checkpoint (paused at ${cp.timestamp}).`,
          `Goal: ${cp.goal}`,
          `Mode: ${session.loopMode || "core"}`,
          `Phase: ${cp.phase} (iteration ${cp.iteration}).`,
          `Launch **${agent}** subagent to continue.`,
        ].join("\n\n"),
      });
      return true;
    }
  }
  return false;
}

function handleBareResume(state, sessionId) {
  const session = getSessionState(state, sessionId);
  if (session.resumable?.paused && session.resumable?.checkpoint) {
    const cp = resumeOrchestra(session);
    if (cp) {
      const agent = agentForCheckpointPhase(cp.phase);
      emit({
        additional_context: [
          AMBIENT_CONTEXT,
          `Orchestra RESUMED from checkpoint (paused at ${cp.timestamp}).`,
          `Goal: ${cp.goal}`,
          `Mode: ${session.loopMode || "core"}`,
          `Phase: ${cp.phase} (iteration ${cp.iteration}).`,
          `Launch **${agent}** subagent to continue.`,
        ].join("\n\n"),
      });
      return true;
    }
  }
  return false;
}

async function main() {
  const input = await readStdinJson();
  const sessionId = getSessionId();
  const state = loadState(null, sessionId);
  const prompt = extractPrompt(input);

  if (/\b(disable orchestra|orchestra off)\b/i.test(prompt)) {
    handleDisable(state, sessionId);
    return;
  }

  if (/\b(enable orchestra|orchestra on|ambient on)\b/i.test(prompt)) {
    handleEnable(state, sessionId);
  }

  if (/\b(resume orchestra|continue orchestra|approve plan)\b/i.test(prompt)) {
    if (handleResume(state, input, sessionId)) return;
    emit({
      additional_context: "No paused orchestration found to resume. Starting fresh if needed.",
    });
    return;
  }

  const session = getSessionState(state, sessionId);
  if (/\b(resume|continue)\b/i.test(prompt) && !session.active) {
    if (handleBareResume(state, sessionId)) return;
    emit({
      additional_context: "No paused orchestration found to resume. Starting fresh if needed.",
    });
    return;
  }

  const classified = classifyPrompt(prompt, session);
  const {
    activate,
    reason,
    goal,
    route,
    routeReason,
    clarifyNeeded,
    clarifyPrompt,
    intake,
    inferFromContext,
    informal,
    greenfield,
  } = classified;
  const isGreenfield = !!(greenfield || intake?.greenfield);
  const ctxBlock = buildContextInjection(detectContextInWorkspaces(input));

  const pyMeta = detectProjectYamlInWorkspaces(input);
  let orchestraConfig = null;
  const identitySync = syncWorkspaceIdentity(session, input);
  if (identitySync) {
    orchestraConfig = extractOrchestraFromIdentity(identitySync.identity);
  } else if (pyMeta) {
    const identity = loadProjectIdentity(pyMeta.root);
    orchestraConfig = extractOrchestraFromIdentity(identity);
  }

  if (!activate) {
    if (session.ambient !== false) {
      const parts = [AMBIENT_CONTEXT];
      if (ctxBlock) parts.push(ctxBlock);
      emit({ additional_context: parts.join("\n\n") });
    } else {
      emit(ctxBlock ? { additional_context: ctxBlock } : {});
    }
    return;
  }

  if (session.active && session.goal && goal && session.goal.slice(0, 80) === goal.slice(0, 80)) {
    const agent = getAgentForPhase(session.currentPhase);
    const parts = [
      AMBIENT_CONTEXT,
      `Orchestra already active for this goal. Mode: ${session.loopMode}. Phase: ${session.currentPhase}.`,
      `Launch **${agent}** subagent for the current phase.`,
      buildPhaseHandoff(session, agent),
    ];
    const warn = handoffWarningBlock(prompt);
    if (warn) parts.push(warn);
    if (ctxBlock) parts.push(ctxBlock);
    emit({ additional_context: parts.join("\n\n") });
    return;
  }

  // Legacy clarify path (kept for safety) — prefer informal_inferred start below
  if (clarifyNeeded && !inferFromContext) {
    const parts = [
      AMBIENT_CONTEXT,
      "Orchestra prompt intake (planner-first) — clarify before implementing.",
      `Draft goal: ${goal || prompt}`,
      clarifyPrompt ||
        "Ask the user for concrete target, success criteria, and constraints. Then re-run with a clearer implement prompt.",
    ];
    if (ctxBlock) parts.push(ctxBlock);
    emit({ additional_context: parts.join("\n\n") });
    return;
  }

  startOrchestra(goal || prompt, state, reason, {
    route: mergeRoute(route, orchestraConfig),
    intake,
    orchestraConfig,
  });

  const ltm = loadLongTermMemory();
  const memCtx = buildMemoryContext(ltm, { query: goal || prompt });
  const modeLabel =
    route === LOOP_MODE_ENTERPRISE ? "enterprise SDLC" : "core loop (plan→implement→verify→review)";

  // Reload session state after startOrchestra
  const freshSession = getSessionState(state, sessionId);
  const firstAgent = getAgentForPhase(freshSession.currentPhase);
  const parts = [
    AMBIENT_CONTEXT,
    `Orchestra auto-started (${reason}, route=${freshSession.loopMode || "core"} / ${routeReason || "default"}) — no /orchestra needed.`,
    `Mode: ${modeLabel}`,
    `Goal: ${goal || prompt}`,
    `Phase: ${freshSession.currentPhase} — launch **${firstAgent}** subagent first (Task tool). Do not implement until planning completes.`,
    buildPhaseHandoff(freshSession, firstAgent),
  ];

  if (informal || inferFromContext) {
    parts.push(
      [
        "Informal/short prompt intake — do **not** block the user.",
        "Planner must expand the goal before PLAN_READY:",
        "1. Read `context/progress-tracker.md` Next Up / Current Goal",
        "2. Read `git status` / recent diff if useful",
        "3. Infer the smallest correct fix/build from repo context",
        "4. State assumed goal + success criteria explicitly in the plan",
        "5. Prefer core scope; ask the user only if 2+ equally likely goals conflict",
      ].join("\n")
    );
  }

  if (isGreenfield) {
    parts.push(buildGreenfieldIntakeBriefing(goal || prompt));
    parts.push(
      [
        "Greenfield mode active:",
        "- First present recommended stack + gather intake (or accept defaults).",
        "- Scaffold with init-project if repo lacks context/project.yaml.",
        `- First agent: **${firstAgent}** (discovery). Do not implement until stack + MVP locked.`,
        "- Then slice into small tasks; each slice = one core orchestra cycle with phase commit gates.",
        "- Loop slices until production checklist passes.",
      ].join("\n")
    );
    if (!pyMeta) {
      parts.push(
        [
          "⚠️ No project.yaml/project.json found in workspace.",
          "Bootstrap project identity + six-file context:",
          "`bash scripts/init-project.sh .`  (flags --type/--name optional)",
        ].join("\n")
      );

      // Auto-scaffold instruction if workspace is truly empty
      const cwd = input.cwd || input.workspace_root || input.workspaceRoot || process.cwd();
      if (shouldAutoScaffold(cwd)) {
        const scaffoldInstr = buildScaffoldInstructionFromGoal(goal || prompt);
        if (scaffoldInstr) {
          parts.push(scaffoldInstr);
        }
      }
    }
  }

  if (route === LOOP_MODE_ENTERPRISE) {
    parts.push(
      "Enterprise mode: discovery/design agents are readonly. Before code changes, ensure a plan exists (orchestra-planner or tech-lead/task-breakdown)."
    );
  } else {
    parts.push("Core mode: **orchestra-planner** → implementer → verifier → reviewer. No code edits in plan phase.");
  }
  if (orchestraConfig?.plan_only) {
    parts.push(
      "Plan-only mode: orchestra pauses after planner. User must say 'continue orchestra' or 'approve plan' before implement."
    );
  }
  if (orchestraConfig) {
    const cfgSummary = buildOrchestraConfigSummary(orchestraConfig);
    if (cfgSummary) parts.push(cfgSummary);
  }
  if (memCtx) parts.push(memCtx);
  if (ctxBlock) {
    parts.push(ctxBlock);
    parts.push("Planner: read all present context/*.md files before PLAN_READY.");
  }
  emit({ additional_context: parts.join("\n\n") });
}

main().catch(() => {
  emit({});
});
