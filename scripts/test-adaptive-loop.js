"use strict";

const assert = require("node:assert/strict");
const {
  classifyPrompt,
  selectRoute,
} = require("../bundle/hooks/lib/prompt-classifier.js");
const {
  getAgentForPhase,
  getNextPhase,
  getPhaseChain,
  getImplementPhaseId,
  advancePhase,
  LOOP_MODE_CORE,
  LOOP_MODE_ENTERPRISE,
} = require("../bundle/hooks/lib/phase-engine.js");
const {
  normalizePhaseFields,
  DEFAULT_STATE,
  startOrchestra,
} = require("../bundle/hooks/lib/state-manager.js");

function test(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

test("default implement routes to core", () => {
  const r = classifyPrompt("fix the login bug in auth.js", { ambient: true });
  assert.equal(r.activate, true);
  assert.equal(r.route, LOOP_MODE_CORE);
  assert.equal(r.intake.firstAgent, "orchestra-planner");
  assert.equal(r.clarifyNeeded, false);
});

test("enterprise flag routes to enterprise", () => {
  const r = classifyPrompt("/enterprise redesign auth architecture", { ambient: true });
  assert.equal(r.activate, true);
  assert.equal(r.route, LOOP_MODE_ENTERPRISE);
});

test("complexity signals select enterprise", () => {
  const info = selectRoute("migrate multi-service architecture to zero-trust", {
    explicit: false,
    implement: true,
    multiStep: true,
  });
  assert.equal(info.route, LOOP_MODE_ENTERPRISE);
  assert.equal(info.routeReason, "complexity_signals");
});

test("short complexity beats informal → enterprise", () => {
  const r = classifyPrompt("migrate architecture", { ambient: true });
  assert.equal(r.activate, true);
  assert.equal(r.route, LOOP_MODE_ENTERPRISE);
  assert.equal(r.routeReason, "complexity_signals");
  assert.equal(r.inferFromContext, false);
  assert.equal(r.informal, false);
});

test("bare security audit activates enterprise", () => {
  const r = classifyPrompt("security audit", { ambient: true });
  assert.equal(r.activate, true);
  assert.equal(r.route, LOOP_MODE_ENTERPRISE);
  assert.equal(r.routeReason, "complexity_signals");
  assert.equal(r.reason, "complexity");
});

test("short informal still starts core with infer", () => {
  for (const text of [
    "fix it",
    "please fix it",
    "next improve",
    "pls fix",
    "pls",
    "build it",
    "fix",
    "make auth work",
  ]) {
    const r = classifyPrompt(text, { ambient: true });
    assert.equal(r.activate, true, text);
    assert.equal(r.route, LOOP_MODE_CORE, text);
    assert.equal(r.routeReason, "informal_inferred", text);
    assert.equal(r.clarifyNeeded, false, text);
    assert.equal(r.inferFromContext, true, text);
    assert.equal(r.informal, true, text);
  }
});

test("startOrchestra core starts at plan", () => {
  const state = structuredClone(DEFAULT_STATE);
  startOrchestra("fix login bug", state, "ambient", { route: LOOP_MODE_CORE });
  assert.equal(state.active, true);
  assert.equal(state.loopMode, LOOP_MODE_CORE);
  assert.equal(state.currentPhase, "plan");
  assert.equal(state.phase, "plan");
});

test("startOrchestra enterprise starts at idea", () => {
  const state = structuredClone(DEFAULT_STATE);
  startOrchestra("security audit", state, "ambient", { route: LOOP_MODE_ENTERPRISE });
  assert.equal(state.loopMode, LOOP_MODE_ENTERPRISE);
  assert.equal(state.currentPhase, "idea");
  assert.equal(state.phase, "idea");
});

test("core agent ids are orchestra-*", () => {
  assert.equal(getAgentForPhase("plan"), "orchestra-planner");
  assert.equal(getAgentForPhase("implement"), "orchestra-implementer");
  assert.equal(getAgentForPhase("verify"), "orchestra-verifier");
  assert.equal(getAgentForPhase("review"), "orchestra-reviewer");
  assert.equal(getAgentForPhase("implementation"), "orchestra-implementer");
});

test("core phase chain plan→implement→verify→review→done", () => {
  assert.equal(getNextPhase("plan", LOOP_MODE_CORE), "implement");
  assert.equal(getNextPhase("implement", LOOP_MODE_CORE), "verify");
  assert.equal(getNextPhase("verify", LOOP_MODE_CORE), "review");
  assert.equal(getNextPhase("review", LOOP_MODE_CORE), "done");
  const chain = getPhaseChain(LOOP_MODE_CORE);
  assert.ok(chain.plan);
  assert.equal(chain.plan.agent, "orchestra-planner");
});

test("advancePhase uses core loopMode", () => {
  const state = {
    loopMode: LOOP_MODE_CORE,
    currentPhase: "plan",
    currentPhaseIndex: 0,
    phaseCategory: "core",
  };
  assert.equal(advancePhase(state), true);
  assert.equal(state.currentPhase, "implement");
  assert.equal(getImplementPhaseId(LOOP_MODE_CORE), "implement");
  assert.equal(getImplementPhaseId(LOOP_MODE_ENTERPRISE), "implementation");
});

test("normalizePhaseFields migrates legacy phase", () => {
  const state = { ...DEFAULT_STATE, phase: "plan", currentPhase: null };
  normalizePhaseFields(state);
  assert.equal(state.currentPhase, "plan");
  assert.equal(state.phase, "plan");
  assert.equal(state.loopMode, LOOP_MODE_CORE);
});

test("questions do not activate", () => {
  const r = classifyPrompt("what is the orchestra loop?", { ambient: true });
  assert.equal(r.activate, false);
  assert.equal(r.reason, "question_only");
});

if (!process.exitCode) {
  console.log("\nAll adaptive loop tests passed.");
}
