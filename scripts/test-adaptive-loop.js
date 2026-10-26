"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
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
  getPhasesForState,
  validatePhaseFilter,
  LOOP_MODE_CORE,
  LOOP_MODE_ENTERPRISE,
  SDLC_PHASES,
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

test("startOrchestra mints a domain ticket and zeroes acCount", () => {
  const state = structuredClone(DEFAULT_STATE);
  startOrchestra("fix login bug", state, "ambient", { route: LOOP_MODE_CORE });
  assert.equal(typeof state.memory.ticketId, "string");
  assert.match(state.memory.ticketId, /^ticket_/);
  assert.equal(state.memory.acCount, 0);
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

const {
  normalizeOrchestraConfig,
  extractOrchestraFromIdentity,
  mergeRoute,
} = require("../bundle/hooks/lib/orchestra-config.js");
const { validateHandoffCompact, MAX_HANDOFF_CHARS } = require("../bundle/hooks/lib/handoff-enforcer.js");
const {
  syncWorkspaceIdentity,
  buildIdentitySyncNotice,
} = require("../bundle/hooks/lib/workspace-identity.js");

test("orchestra config defaults from project.yaml shape", () => {
  const cfg = normalizeOrchestraConfig({
    route: "core",
    max_iterations: 12,
    plan_only: true,
    token_budgets: { planner: 8000, cycle: 50000 },
  });
  assert.equal(cfg.route, "core");
  assert.equal(cfg.max_iterations, 12);
  assert.equal(cfg.plan_only, true);
  assert.equal(cfg.token_budgets.planner, 8000);
  assert.equal(cfg.token_budgets.implementer, 30000);
  assert.equal(cfg.token_budgets.cycle, 50000);
});

test("extractOrchestraFromIdentity reads orchestra block", () => {
  const cfg = extractOrchestraFromIdentity({
    project: { name: "x" },
    orchestra: { route: "enterprise", max_iterations: 20 },
  });
  assert.equal(cfg.route, "enterprise");
  assert.equal(cfg.max_iterations, 20);
});

test("mergeRoute keeps explicit enterprise over project core", () => {
  assert.equal(mergeRoute("enterprise", { route: "core" }), "enterprise");
  assert.equal(mergeRoute("core", { route: "enterprise" }), "enterprise");
});

test("startOrchestra applies orchestraConfig max_iterations", () => {
  const state = JSON.parse(JSON.stringify(DEFAULT_STATE));
  state.lifecycle = { events: [], phase_history: [] };
  state.heartbeat = { ...DEFAULT_STATE.heartbeat };
  state.memory = { ...DEFAULT_STATE.memory };
  state.resumable = { ...DEFAULT_STATE.resumable };
  startOrchestra("test goal", state, "test", {
    orchestraConfig: normalizeOrchestraConfig({ max_iterations: 5, plan_only: false }),
  });
  assert.equal(state.max_iterations, 5);
  assert.equal(state.orchestraConfig.max_iterations, 5);
});

test("handoff enforcer rejects verbose prompts", () => {
  const short = validateHandoffCompact("goal\nplan bullet");
  assert.equal(short.ok, true);
  const long = validateHandoffCompact("x".repeat(MAX_HANDOFF_CHARS + 1));
  assert.equal(long.ok, false);
});

test("enterprise phase picker filters SDLC chain", () => {
  const state = {
    loopMode: LOOP_MODE_ENTERPRISE,
    orchestraConfig: { phases: ["task-breakdown", "implementation", "unit-testing"] },
  };
  const phases = getPhasesForState(state);
  assert.equal(phases.length, 3);
  assert.equal(phases[0].id, "task-breakdown");
  assert.equal(phases[2].id, "unit-testing");
  const chain = getPhaseChain(state);
  assert.equal(chain["task-breakdown"].nextPhase, "implementation");
  assert.equal(chain["unit-testing"].nextPhase, "done");
});

test("validatePhaseFilter flags unknown ids", () => {
  const v = validatePhaseFilter(["plan", "not-a-phase", "implementation"], SDLC_PHASES);
  assert.equal(v.unknown.includes("not-a-phase"), true);
  assert.equal(v.unknown.includes("plan"), true);
  assert.equal(v.effective.includes("implementation"), true);
});

test("filtered enterprise starts at first enabled phase", () => {
  const state = JSON.parse(JSON.stringify(DEFAULT_STATE));
  state.lifecycle = { events: [], phase_history: [] };
  state.heartbeat = { ...DEFAULT_STATE.heartbeat };
  state.memory = { ...DEFAULT_STATE.memory };
  state.resumable = { ...DEFAULT_STATE.resumable };
  startOrchestra("enterprise slice", state, "test", {
    route: LOOP_MODE_ENTERPRISE,
    orchestraConfig: normalizeOrchestraConfig({
      phases: ["task-breakdown", "implementation"],
    }),
  });
  assert.equal(state.currentPhase, "task-breakdown");
  assert.equal(state.loopMode, LOOP_MODE_ENTERPRISE);
});

test("syncWorkspaceIdentity refreshes stale slug when idle", () => {
  const repoRoot = path.join(__dirname, "..");
  const state = JSON.parse(JSON.stringify(DEFAULT_STATE));
  state.active = false;
  state.project = { ...DEFAULT_STATE.project, slug: "sample-app", name: "sample-app" };
  const result = syncWorkspaceIdentity(state, { workspace_roots: [repoRoot] });
  assert.ok(result);
  assert.equal(result.synced, true);
  assert.equal(state.project.slug, "pcore-orchestra");
  assert.equal(result.reason, "stale_slug_refreshed");
  const notice = buildIdentitySyncNotice(result);
  assert.match(notice, /pcore-orchestra/);
});

test("syncWorkspaceIdentity skips full sync when orchestra active", () => {
  const repoRoot = path.join(__dirname, "..");
  const state = JSON.parse(JSON.stringify(DEFAULT_STATE));
  state.active = true;
  state.project = { ...DEFAULT_STATE.project, slug: "sample-app", name: "sample-app" };
  const result = syncWorkspaceIdentity(state, { workspace_roots: [repoRoot] });
  assert.ok(result);
  assert.equal(result.synced, false);
  assert.equal(state.project.slug, "sample-app");
  assert.ok(state.project.identityFile);
});

const {
  retrieveRelevantGoals,
  tokenize,
} = require("../bundle/hooks/lib/semantic-memory.js");

test("semantic memory retrieves relevant goals by keyword", () => {
  const goals = [
    { goal: "fix orchestra hooks token tracker", outcome: "completed", duration_ms: 1000, lessons: ["use head_limit"] },
    { goal: "deploy web app to VPS", outcome: "completed", duration_ms: 2000, lessons: [] },
    { goal: "add semantic recall to memory", outcome: "completed", duration_ms: 500, lessons: ["BM25-lite"] },
  ];
  const hits = retrieveRelevantGoals(goals, "token tracker orchestra");
  assert.ok(hits.length >= 1);
  assert.match(hits[0].goal, /token tracker/i);
});

test("tokenize strips stop words", () => {
  const tokens = tokenize("fix the orchestra loop for hooks");
  assert.ok(tokens.includes("orchestra"));
  assert.ok(tokens.includes("hooks"));
  assert.equal(tokens.includes("the"), false);
});

const fs = require("node:fs");
const os = require("node:os");
const {
  savePlanArtifact,
  buildPlanHandoffLine,
  hasPlanReady,
} = require("../bundle/hooks/lib/plan-artifact.js");
const { writeCycleReport, listCycleReports } = require("../bundle/hooks/lib/cycle-report.js");

test("savePlanArtifact writes workspace plan file", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orch-plan-"));
  const state = JSON.parse(JSON.stringify(DEFAULT_STATE));
  state.goal = "test plan artifact";
  state.tokens = { run_id: "run-testplan" };
  state.project.identityFile = path.join(tmp, "project.yaml");
  fs.writeFileSync(state.project.identityFile, "project:\n  name: t\n");

  const artifact = savePlanArtifact(state, {
    output: "## Goal\nTest\n\nPLAN_READY",
  });
  assert.ok(artifact);
  assert.equal(hasPlanReady(fs.readFileSync(artifact.path, "utf8")), true);
  assert.ok(fs.existsSync(artifact.path));
  const handoff = buildPlanHandoffLine(state, "orchestra-implementer");
  assert.match(handoff, /orchestra-plan\.md/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("savePlanArtifact counts Done-when bullets into memory.acCount", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orch-ac-"));
  const state = JSON.parse(JSON.stringify(DEFAULT_STATE));
  state.goal = "ac count";
  state.tokens = { run_id: "run-testac" };
  state.project.identityFile = path.join(tmp, "project.yaml");
  fs.writeFileSync(state.project.identityFile, "project:\n  name: t\n");
  state.memory = { phases_completed: [], files_changed: [], errors: [], decisions: [], context_summary: "" };

  savePlanArtifact(state, {
    output: "## Plan\nSteps\n\n## Done when\n- tests pass\n- lint clean\n\n## Notes\n- ignored bullet\n",
  });
  assert.equal(state.memory.acCount, 2);

  // Section absent -> acCount keeps its previous value (never clobbered to 0)
  savePlanArtifact(state, { output: "## Plan\nNo criteria section here\n" });
  assert.equal(state.memory.acCount, 2);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("writeCycleReport creates cycle json", () => {
  const state = JSON.parse(JSON.stringify(DEFAULT_STATE));
  state.goal = "cycle test";
  state.tokens = { run_id: "run-cycletest", started_at: new Date().toISOString() };
  state.memory = { phases_completed: [{ phase: "plan", agent: "orchestra-planner" }] };
  const report = writeCycleReport(state, "completed");
  assert.equal(report.outcome, "completed");
  assert.equal(report.goal, "cycle test");
  const listed = listCycleReports(5);
  assert.ok(listed.some((r) => r.run_id === "run-cycletest"));
});

const {
  checkPhaseCommitGate,
  buildCommitGateHandoff,
} = require("../bundle/hooks/lib/phase-commit-gate.js");

test("phase commit gate passes on clean tree", () => {
  const gate = checkPhaseCommitGate({}, { cwd: path.join(__dirname, "..") });
  assert.equal(typeof gate.clean, "boolean");
  assert.ok(gate.message);
});

test("phase commit gate reports SKIPPED when git status is unavailable", () => {
  const gate = checkPhaseCommitGate({}, { cwd: "/no-such-dir-pcore-test" });
  assert.equal(gate.skipped, true);
  assert.equal(gate.clean, true);
  assert.match(gate.message, /SKIPPED/);
});

test("commit-gate handoff honors the skip for verifier", () => {
  const out = buildCommitGateHandoff({}, "orchestra-verifier", { cwd: "/no-such-dir-pcore-test" });
  assert.match(out, /SKIPPED/);
});

test("phase commit gate fails closed when git cannot run inside an existing repo", () => {
  const realPath = process.env.PATH;
  process.env.PATH = path.join(os.tmpdir(), "pcore-no-git-on-path");
  try {
    const gate = checkPhaseCommitGate({}, { cwd: path.join(__dirname, "..") });
    assert.equal(gate.gitError, true);
    assert.equal(gate.clean, false);
    assert.equal(gate.skipped, false);
    assert.match(gate.message, /git-error/);
  } finally {
    process.env.PATH = realPath;
  }
});

test("phase commit gate skips an existing directory outside any repo", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcore-no-repo-"));
  try {
    const gate = checkPhaseCommitGate({}, { cwd: dir });
    assert.equal(gate.notGitRepo, true);
    assert.equal(gate.skipped, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("greenfield build a note app routes enterprise with intake", () => {
  const r = classifyPrompt("let's build a note app", { ambient: true });
  assert.equal(r.activate, true);
  assert.equal(r.route, LOOP_MODE_ENTERPRISE);
  assert.equal(r.routeReason, "greenfield_product");
  assert.equal(r.greenfield, true);
  assert.equal(r.intake.firstAgent, "business-analyst");
  assert.equal(r.intake.appType, "notes");
});

test("greenfield stack briefing includes recommended", () => {
  const { buildGreenfieldIntakeBriefing } = require("../bundle/hooks/lib/greenfield-intake.js");
  const brief = buildGreenfieldIntakeBriefing("build a todo app");
  assert.match(brief, /Recommended stack/i);
  assert.match(brief, /todo/i);
  assert.match(brief, /Intake questions/i);
});

const tokenTracker = require("../bundle/hooks/lib/token-tracker.js");

test("token tracker records prompt-cache reads and hit rate", () => {
  const usage = tokenTracker.extractReportedUsage({
    usage: { input_tokens: 2000, output_tokens: 500, cache_read_input_tokens: 6000, cache_creation_input_tokens: 100 },
  });
  assert.equal(usage.cache_read_tokens, 6000);
  assert.equal(usage.cache_creation_tokens, 100);

  const state = structuredClone(DEFAULT_STATE);
  startOrchestra("cache tracking goal", state, "test", { route: LOOP_MODE_CORE });
  state.currentPhase = "implement";
  const entry = tokenTracker.recordPhaseTokens(
    state,
    { usage: { input_tokens: 2000, output_tokens: 500, cache_read_input_tokens: 6000 }, summary: "ok" },
    "orchestra-implementer"
  );
  assert.equal(entry.cache_read_tokens, 6000);
  assert.equal(entry.cache_hit_rate, 75); // 6000 / (6000 + 2000)
  assert.equal(state.tokens.total_cache_read, 6000);

  // Reported input but nothing cached -> honest 0%
  const entry2 = tokenTracker.recordPhaseTokens(
    state,
    { usage: { input_tokens: 100, output_tokens: 50 }, summary: "ok" },
    "orchestra-implementer"
  );
  assert.equal(entry2.cache_read_tokens, 0);
  assert.equal(entry2.cache_hit_rate, 0);

  // Estimated-only phase (no usage object) -> rate stays null, never a fake number
  const entry3 = tokenTracker.recordPhaseTokens(state, { summary: "no usage" }, "orchestra-implementer");
  assert.equal(entry3.cache_read_tokens, 0);
  assert.equal(entry3.cache_hit_rate, null);
});

if (!process.exitCode) {
  console.log("\nAll adaptive loop tests passed.");
}
