#!/usr/bin/env node
"use strict";

const { readStdinJson, emit } = require("./lib/io.js");
const { loadState, saveState } = require("./lib/state-manager.js");
const {
  detectContextInWorkspaces,
  buildContextInjection,
  AMBIENT_CONTEXT,
  PARENT_HANDOFF_CONTEXT,
} = require("./lib/context-detector.js");
const { loadLongTermMemory, buildMemoryContext } = require("./lib/memory-manager.js");
const { detectCrashRecovery } = require("./lib/checkpoint-manager.js");
const { buildTokenContextForSession } = require("./lib/token-tracker.js");
const {
  detectProjectYamlInWorkspaces,
  buildProjectYamlInjection,
} = require("./lib/context-detector.js");
const {
  syncWorkspaceIdentity,
  buildIdentitySyncNotice,
} = require("./lib/workspace-identity.js");

async function main() {
  const input = await readStdinJson();
  const state = loadState();

  const identitySync = syncWorkspaceIdentity(state, input);
  const identityNotice = buildIdentitySyncNotice(identitySync);

  // Cache-shaped injection: stable prefix first, dynamic tail last (prompt-cache friendly).
  const staticParts = [AMBIENT_CONTEXT, PARENT_HANDOFF_CONTEXT];

  const ctx = detectContextInWorkspaces(input);
  const ctxBlock = buildContextInjection(ctx);
  if (ctxBlock) staticParts.push(ctxBlock);

  const pyMeta = identitySync?.pyMeta || detectProjectYamlInWorkspaces(input);
  if (pyMeta) {
    const identity = identitySync?.identity || require("./lib/project-identity.js").loadProjectIdentity(pyMeta.root);
    const pyBlock = buildProjectYamlInjection(identity);
    if (pyBlock) staticParts.push(pyBlock);
  }

  const dynamicParts = [];
  if (identityNotice) dynamicParts.push(identityNotice);

  if (state.active) {
    const crash = detectCrashRecovery(state);
    if (crash) {
      dynamicParts.push(
        `Orchestra was ACTIVE when session ended (possible crash or restart).`,
        `Goal: ${crash.goal}`,
        `Last phase: ${crash.phase} (iteration ${crash.iteration}).`,
        `Last activity: ${crash.last_activity}.`,
        `To resume: say "resume orchestra" or "continue orchestra".`,
        `To discard: say "stop orchestra" or "new goal".`
      );
    } else {
      dynamicParts.push(
        `Orchestra ACTIVE — goal: ${state.goal}`,
        `Mode: ${state.loopMode || "core"}. Phase: ${state.currentPhase}. Continue with the matching subagent.`
      );
    }

    if (state.memory?.phases_completed?.length > 0) {
      const completed = state.memory.phases_completed.map((p) => p.phase).join(" → ");
      dynamicParts.push(`Phases completed so far: ${completed}`);
    }
  }

  const ltm = loadLongTermMemory();
  const memQuery = state.goal || input.prompt || input.goal || "";
  const memCtx = buildMemoryContext(ltm, memQuery ? { query: memQuery } : undefined);
  if (memCtx) dynamicParts.push(memCtx);

  const tokenCtx = buildTokenContextForSession();
  if (tokenCtx) dynamicParts.push(tokenCtx);

  emit({ additional_context: [...staticParts, ...dynamicParts].join("\n\n") });
}

main().catch(() => {
  emit({});
});
