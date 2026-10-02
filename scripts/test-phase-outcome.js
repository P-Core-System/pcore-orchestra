#!/usr/bin/env node
"use strict";

/**
 * Step 3 self-check: phase outcome gate engine.
 *
 * Unit  - PHASE_END_TOKENS contract, evaluatePhaseOutcome decision table,
 *         passGate clearing a stale failure.
 * Integ - spawn orchestra-subagent-stop.js and assert block / advance / fix.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const HOOK = path.join(ROOT, "bundle", "hooks", "orchestra-subagent-stop.js");

let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------- unit: tokens
const { PHASE_END_TOKENS, PHASE_BLOCKED_EVENT } = require("../bundle/hooks/lib/constants.js");

check("PHASE_END_TOKENS.plan", eq(PHASE_END_TOKENS.plan, ["PLAN_READY"]), JSON.stringify(PHASE_END_TOKENS.plan));
check("PHASE_END_TOKENS.implement", eq(PHASE_END_TOKENS.implement, ["IMPLEMENT_DONE"]), JSON.stringify(PHASE_END_TOKENS.implement));
check(
  "PHASE_END_TOKENS.verify",
  eq(PHASE_END_TOKENS.verify, ["VERIFY_PASS", "VERIFY_FAIL"]),
  JSON.stringify(PHASE_END_TOKENS.verify)
);
check(
  "PHASE_END_TOKENS.review",
  eq(PHASE_END_TOKENS.review, ["ORCHESTRA_COMPLETE", "FIX_REQUIRED"]),
  JSON.stringify(PHASE_END_TOKENS.review)
);
check("PHASE_BLOCKED_EVENT constant", PHASE_BLOCKED_EVENT === "phase_blocked", String(PHASE_BLOCKED_EVENT));

// ------------------------------------------------------- unit: outcome engine
const { evaluatePhaseOutcome } = require("../bundle/hooks/lib/phase-outcome.js");

function mkState(phase, extra) {
  return Object.assign(
    { active: true, goal: "gate check", currentPhase: phase, loopMode: "core" },
    extra || {}
  );
}
function mkInput(text) {
  return text === undefined ? {} : { summary: text };
}

const okPlan = evaluatePhaseOutcome(mkState("plan"), mkInput("PLAN_READY\nSteps 0-8 defined."));
check("plan + PLAN_READY -> advance", okPlan.decision === "advance" && okPlan.token === "PLAN_READY", JSON.stringify(okPlan));
check("plan + PLAN_READY has no warning", !okPlan.warning, String(okPlan.warning));

const blockPlan = evaluatePhaseOutcome(mkState("plan"), mkInput("I wrote some notes."));
check("plan without token -> block", blockPlan.decision === "block", JSON.stringify(blockPlan));
check("plan block reason = token-missing", blockPlan.reason === "token-missing", String(blockPlan.reason));
check("plan block message names PLAN_READY", /PLAN_READY/.test(blockPlan.message || ""), String(blockPlan.message));

const emptyPlan = evaluatePhaseOutcome(mkState("plan"), mkInput(undefined));
check("plan with no output -> advance (never brick)", emptyPlan.decision === "advance", JSON.stringify(emptyPlan));
check("plan no-output carries a warning", /no output/i.test(emptyPlan.warning || ""), String(emptyPlan.warning));

const wsPlan = evaluatePhaseOutcome(mkState("plan"), { text: "PLAN_READY" });
check("input.text is honoured", wsPlan.decision === "advance" && wsPlan.token === "PLAN_READY", JSON.stringify(wsPlan));

const doneImpl = evaluatePhaseOutcome(mkState("implement"), mkInput("IMPLEMENT_DONE"));
check("implement + IMPLEMENT_DONE -> advance", doneImpl.decision === "advance", JSON.stringify(doneImpl));

const missImpl = evaluatePhaseOutcome(mkState("implement"), mkInput("still working"));
check("implement without token -> block", missImpl.decision === "block", JSON.stringify(missImpl));

const verifyFail = evaluatePhaseOutcome(mkState("verify"), mkInput("VERIFY_FAIL: 2 tests red"));
check("verify + VERIFY_FAIL -> fix", verifyFail.decision === "fix", JSON.stringify(verifyFail));
check("verify fix reason = fix-token", verifyFail.reason === "fix-token", String(verifyFail.reason));

const verifyPassGates = evaluatePhaseOutcome(
  mkState("verify", { qualityGates: { passed: [], failed: [{ id: "tests", reason: "2 red" }], skipped: [] } }),
  mkInput("VERIFY_PASS")
);
check("verify + VERIFY_PASS but failed gates -> block", verifyPassGates.decision === "block", JSON.stringify(verifyPassGates));
check("gate block reason = failed-gates", verifyPassGates.reason === "failed-gates", String(verifyPassGates.reason));
check("gate block message lists tests", /tests/.test(verifyPassGates.message || ""), String(verifyPassGates.message));

const fixBeatsGates = evaluatePhaseOutcome(
  mkState("review", { qualityGates: { passed: [], failed: [{ id: "tests", reason: "red" }], skipped: [] } }),
  mkInput("FIX_REQUIRED: address blockers")
);
check("FIX_REQUIRED wins over failed gates", fixBeatsGates.decision === "fix", JSON.stringify(fixBeatsGates));

const reviewComplete = evaluatePhaseOutcome(mkState("review"), mkInput("ORCHESTRA_COMPLETE"));
check("review + ORCHESTRA_COMPLETE + clean gates -> advance", reviewComplete.decision === "advance", JSON.stringify(reviewComplete));

const entPlan = evaluatePhaseOutcome(mkState("idea", { loopMode: "enterprise" }), mkInput("here is the idea"));
check("enterprise phase -> advance (warning only)", entPlan.decision === "advance", JSON.stringify(entPlan));
check("enterprise phase warns", /enterprise|contract/i.test(entPlan.warning || ""), String(entPlan.warning));

const unknownCore = evaluatePhaseOutcome(mkState("retrospective"), mkInput("wrapped up"));
check("unknown core phase -> advance (warning only)", unknownCore.decision === "advance", JSON.stringify(unknownCore));

// --- fix loop 1: gates are phase-scoped (verify/review) -------------------
const implRedGates = evaluatePhaseOutcome(
  mkState("implement", { qualityGates: { passed: [], failed: [{ id: "tests", reason: "2 red" }], skipped: [], allRequiredPassed: false } }),
  mkInput("IMPLEMENT_DONE\nfix committed; evidence re-run pending at verify")
);
check(
  "implement + IMPLEMENT_DONE + red gates -> advance (no fix-loop deadlock)",
  implRedGates.decision === "advance",
  JSON.stringify(implRedGates)
);

const planRedGates = evaluatePhaseOutcome(
  mkState("plan", { qualityGates: { passed: [], failed: [{ id: "tests" }], skipped: [], allRequiredPassed: false } }),
  mkInput("PLAN_READY\nEvidence still red from the previous cycle.")
);
check("plan + PLAN_READY + red gates -> advance", planRedGates.decision === "advance", JSON.stringify(planRedGates));

const verifyRedGatesStillBlocks = evaluatePhaseOutcome(
  mkState("verify", { qualityGates: { passed: [], failed: [{ id: "tests" }], skipped: [], allRequiredPassed: false } }),
  mkInput("VERIFY_PASS")
);
check(
  "verify + VERIFY_PASS + red gates still -> block",
  verifyRedGatesStillBlocks.decision === "block" && verifyRedGatesStillBlocks.reason === "failed-gates",
  JSON.stringify(verifyRedGatesStillBlocks)
);

// --- fix loop 2: failed gates outrank the empty-output advance -------------
const reviewEmptyObjRed = evaluatePhaseOutcome(
  mkState("review", { qualityGates: { passed: [], failed: [{ id: "tests", reason: "2 red" }], skipped: [], allRequiredPassed: false } }),
  {}
);
check(
  "review + red gates + empty output -> block (failed-gates)",
  reviewEmptyObjRed.decision === "block",
  JSON.stringify(reviewEmptyObjRed)
);
check("empty-output gate block reason = failed-gates", reviewEmptyObjRed.reason === "failed-gates", String(reviewEmptyObjRed.reason));

const reviewWsRed = evaluatePhaseOutcome(
  mkState("review", { qualityGates: { passed: [], failed: [{ id: "tests" }], skipped: [], allRequiredPassed: false } }),
  { summary: "   \n\t  " }
);
check(
  "review + red gates + whitespace-only output -> block",
  reviewWsRed.decision === "block" && reviewWsRed.reason === "failed-gates",
  JSON.stringify(reviewWsRed)
);

const verifyEmptyRed = evaluatePhaseOutcome(
  mkState("verify", { qualityGates: { passed: [], failed: [{ id: "tests" }], skipped: [], allRequiredPassed: false } }),
  {}
);
check(
  "verify + red gates + empty output -> block",
  verifyEmptyRed.decision === "block" && verifyEmptyRed.reason === "failed-gates",
  JSON.stringify(verifyEmptyRed)
);

const reviewEmptyGreen = evaluatePhaseOutcome(mkState("review"), mkInput(undefined));
check(
  "review + clean gates + empty output -> advance (never brick on silence)",
  reviewEmptyGreen.decision === "advance" && reviewEmptyGreen.reason === "empty-output",
  JSON.stringify(reviewEmptyGreen)
);

// passGate must clear a stale failure so a red gate can recover
const qg = require("../bundle/hooks/lib/quality-gate.js");
const gateState = { qualityGates: { passed: [], failed: [{ id: "tests", reason: "old" }], skipped: [], allRequiredPassed: false } };
qg.passGate(gateState, "tests", "re-run green");
check("passGate clears a stale failure", gateState.qualityGates.failed.length === 0, JSON.stringify(gateState.qualityGates.failed));
check("passGate records the pass", gateState.qualityGates.passed.some((g) => g.id === "tests"), JSON.stringify(gateState.qualityGates.passed));

// ------------------------------------------------------------ integration
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orchestra-outcome-"));
const stateDir = path.join(tmp, "state");
fs.mkdirSync(stateDir, { recursive: true });

const env = Object.assign({}, process.env, {
  PCORE_STATE_DIR: stateDir,
  PCORE_SESSION_ID: "outcome-test",
});
delete env.CURSOR_TRACE_ID;
delete env.OPENCODE_SESSION_ID;
delete env.CLAUDE_SESSION_ID;

function seed(sessionOverrides) {
  const root = {
    version: 3,
    sessions: {
      "outcome-test": Object.assign(
        {
          active: true,
          goal: "gate integration",
          currentPhase: "plan",
          loopMode: "core",
          iteration: 0,
          max_iterations: 20,
        },
        sessionOverrides || {}
      ),
    },
  };
  fs.writeFileSync(path.join(stateDir, "orchestra.json"), JSON.stringify(root, null, 2));
}

function runHook(subagentType, summary) {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ status: "completed", subagent_type: subagentType, summary }),
    env,
    cwd: tmp,
    encoding: "utf8",
    timeout: 60000,
  });
}

function readSession() {
  const root = JSON.parse(fs.readFileSync(path.join(stateDir, "orchestra.json"), "utf8"));
  return root.sessions["outcome-test"];
}

function residue() {
  const a = fs.readdirSync(stateDir);
  const b = fs.existsSync(path.join(tmp, ".cursor")) ? fs.readdirSync(path.join(tmp, ".cursor")) : [];
  return a.concat(b);
}

// A: plan phase without the end token must NOT advance
seed();
let out = runHook("orchestra-planner", "Drafted a plan but forgot the handshake.");
check("A exits 0", out.status === 0, out.stderr);
let s = readSession();
check("A blocked (phase stays plan)", s.currentPhase === "plan", s.currentPhase);
check("A records last_outcome block", s.last_outcome && s.last_outcome.decision === "block", JSON.stringify(s.last_outcome));
check(
  "A emits corrective followup with PLAN_READY",
  /PLAN_READY/.test(JSON.parse(out.stdout || "{}").followup_message || ""),
  out.stdout
);
check(
  "A records phase_blocked lifecycle event",
  Array.isArray(s.lifecycle?.events) && s.lifecycle.events.some((e) => e.type === "phase_blocked"),
  JSON.stringify((s.lifecycle?.events || []).map((e) => e.type))
);
check("A did not double-save corrupt state", eq(readSession().currentPhase, "plan"));

// B: plan phase with PLAN_READY advances
seed();
out = runHook("orchestra-planner", "PLAN_READY\nSteps 0-8 defined, gates listed.");
check("B exits 0", out.status === 0, out.stderr);
s = readSession();
check("B advanced to implement", s.currentPhase === "implement", s.currentPhase);
check("B records last_outcome advance", s.last_outcome && s.last_outcome.decision === "advance", JSON.stringify(s.last_outcome));

// C: verify + VERIFY_FAIL routes back to implement (fix path)
seed({ currentPhase: "verify", iteration: 1 });
out = runHook("orchestra-verifier", "VERIFY_FAIL: unit tests red");
check("C exits 0", out.status === 0, out.stderr);
s = readSession();
check("C fix routes to implement", s.currentPhase === "implement", s.currentPhase);
check("C records last_outcome fix", s.last_outcome && s.last_outcome.decision === "fix", JSON.stringify(s.last_outcome));

// C2: the implementer must NOT be dead-locked by the still-red gates —
// verify re-runs evidence on entry, so implement advances on its own token.
seed({
  currentPhase: "implement",
  iteration: 1,
  qualityGates: { passed: [], failed: [{ id: "tests", reason: "2 red" }], skipped: [], allRequiredPassed: false },
});
out = runHook("orchestra-implementer", "IMPLEMENT_DONE\nfix committed; evidence re-run pending");
check("C2 exits 0", out.status === 0, out.stderr);
s = readSession();
check("C2 implement advances despite red gates (loop converges)", s.currentPhase === "verify", s.currentPhase);
check("C2 records last_outcome advance", s.last_outcome && s.last_outcome.decision === "advance", JSON.stringify(s.last_outcome));

// C3: verify re-runs evidence, gates go green, the loop keeps moving
seed({
  currentPhase: "verify",
  iteration: 1,
  qualityGates: { passed: [{ id: "tests" }], failed: [], skipped: [], allRequiredPassed: true },
});
out = runHook("orchestra-verifier", "VERIFY_PASS: tests green after re-run");
check("C3 exits 0", out.status === 0, out.stderr);
s = readSession();
check("C3 advanced to review", s.currentPhase === "review", s.currentPhase);

// D: review with failed required gates must not complete (the old P0-1 bug)
seed({
  currentPhase: "review",
  iteration: 2,
  qualityGates: { passed: [{ id: "docs-updated" }], failed: [{ id: "tests", reason: "2 red" }], skipped: [], allRequiredPassed: false },
});
out = runHook("orchestra-reviewer", "ORCHESTRA_COMPLETE: everything looks good");
check("D exits 0", out.status === 0, out.stderr);
s = readSession();
check("D blocked on failed gates", s.currentPhase === "review", s.currentPhase);
check("D last_outcome reason = failed-gates", s.last_outcome && s.last_outcome.reason === "failed-gates", JSON.stringify(s.last_outcome));
check(
  "D does not emit a completion summary",
  !/complete for goal/i.test(JSON.parse(out.stdout || "{}").followup_message || ""),
  out.stdout
);

// E: verify with VERIFY_PASS and clean gates advances to review
seed({
  currentPhase: "verify",
  iteration: 1,
  qualityGates: { passed: [{ id: "tests" }], failed: [], skipped: [], allRequiredPassed: true },
});
out = runHook("code-reviewer", "VERIFY_PASS: evidence green");
check("E exits 0", out.status === 0, out.stderr);
s = readSession();
check("E advanced to review", s.currentPhase === "review", s.currentPhase);

// F: FIX_REQUIRED at the iteration cap still records the run + cycle report
seed({ currentPhase: "review", iteration: 20, max_iterations: 20 });
out = runHook("orchestra-reviewer", "FIX_REQUIRED: blockers remain but the loop is at cap");
check("F exits 0", out.status === 0, out.stderr);
s = readSession();
check("F at-cap run deactivates", s.active === false && s.currentPhase === "idle", JSON.stringify({ active: s.active, phase: s.currentPhase }));
check(
  "F records a max_iterations lifecycle event",
  Array.isArray(s.lifecycle?.events) && s.lifecycle.events.some((e) => e.type === "max_iterations"),
  JSON.stringify((s.lifecycle?.events || []).map((e) => e.type))
);
const historyPath = path.join(stateDir, "orchestra-history.json");
const history = fs.existsSync(historyPath) ? JSON.parse(fs.readFileSync(historyPath, "utf8")) : [];
check(
  "F records orchestration run (max_iterations)",
  Array.isArray(history) && history.some((r) => r.outcome === "max_iterations"),
  JSON.stringify(Array.isArray(history) ? history.map((r) => r.outcome) : history)
);
const cyclesIndexPath = path.join(stateDir, "index.json"); // resolveStateDir() flattens to PCORE_STATE_DIR
const cyclesIndex = fs.existsSync(cyclesIndexPath) ? JSON.parse(fs.readFileSync(cyclesIndexPath, "utf8")) : { cycles: [] };
check(
  "F writes a cycle report (max_iterations)",
  Array.isArray(cyclesIndex.cycles) && cyclesIndex.cycles.some((c) => c.outcome === "max_iterations"),
  JSON.stringify(cyclesIndex.cycles || [])
);
check(
  "F persists lastCycleReport on the session",
  s.lastCycleReport && s.lastCycleReport.outcome === "max_iterations" && fs.existsSync(s.lastCycleReport.path),
  JSON.stringify(s.lastCycleReport)
);

// no lock / tmp residue anywhere in the harness dir
const dirty = residue().filter((f) => f.endsWith(".lock") || f.includes(".tmp."));
check("no lock/tmp residue", dirty.length === 0, dirty.join(","));

console.log(failed === 0 ? "\nAll phase outcome tests passed." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
