#!/usr/bin/env node
"use strict";

/**
 * Self-check for the session learning loop (Wave3 distill step):
 *  1. recordSessionOutcome additive extra (learned -> session.learned with
 *     outcome/lessons/threadRef; old actions still store, fail-open)
 *  2. recordLearning helper (learned event, junk fail-open)
 *  3. distillLearnings rules (wake-throttle, wake-denied, thread-resolved,
 *     escalation, session-lesson; junk-proof, pure)
 *  4. distillAndSave round-trip (artifact dir, ring cap, merge)
 *  5. approveCandidate human gate (no decision/by refused, approve flips,
 *     reject flips, unknown id, double-decide refused, never auto-applies:
 *     no source file is touched)
 *  6. no .tmp residue
 *
 * All state is redirected to temp dirs (PCORE_STATE_DIR /
 * PCORE_CONDUCTOR_STATE_DIR plus a temp artifact dir); the real home
 * config is never touched.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "learn-state-"));
const conductorDir = fs.mkdtempSync(path.join(os.tmpdir(), "learn-conductor-"));
const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), "learn-artifact-"));

process.env.PCORE_STATE_DIR = stateDir;
process.env.PCORE_CONDUCTOR_STATE_DIR = conductorDir;
delete process.env.PCORE_MEMBER_NAME;
delete process.env.PCORE_TEAM_NAME;

const learn = require("../bundle/hooks/lib/distill-learnings.js");
const constants = require("../bundle/hooks/lib/domain/constants.js");
const domain = require("../bundle/hooks/lib/domain/index.js");
const claims = require("../bundle/hooks/lib/session-claims.js");

let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function mkWorkspace(projectSlug) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "learn-ws-"));
  if (projectSlug) {
    fs.writeFileSync(path.join(dir, "project.yaml"), `project:\n  name: ${projectSlug}\n  slug: ${projectSlug}\n`, "utf8");
  }
  return dir;
}

try {
  // ---- 1. session outcome extra ----
  check("domain +session.learned type", constants.DOMAIN_EVENT_TYPES.indexOf("session.learned") !== -1);
  const ws = mkWorkspace("proj-one");
  const member = claims.claimSession({ member: "mia", team: "zeta", workspace: ws, sessionId: "s-mia" });
  const learned = domain.recordSessionOutcome(member, "learned", null, { outcome: "shipped", lessons: "batch nudges", threadRef: "deploy" });
  check("learned stores outcome/lessons/threadRef",
    !!learned && learned.type === "session.learned" &&
    learned.payload.outcome === "shipped" && learned.payload.lessons === "batch nudges" && learned.payload.threadRef === "deploy",
    JSON.stringify(learned && learned.payload));
  const claimed = domain.recordSessionOutcome(member, "claimed");
  check("old actions still store", !!claimed && claimed.type === "session.claimed" &&
    claimed.payload.outcome === null && claimed.payload.lessons === null && claimed.payload.threadRef === null);
  check("fail-open preserved", domain.recordSessionOutcome(null, "learned") === null && domain.recordSessionOutcome(member, "explode") === null);

  // ---- 2. recordLearning ----
  const rec = learn.recordLearning(member, { outcome: "shipped", lessons: "batch", threadRef: "t" });
  check("recordLearning appends session.learned", !!rec && rec.type === "session.learned" && rec.payload.lessons === "batch");
  check("recordLearning fail-open", learn.recordLearning(null, { outcome: "x" }) === null && learn.recordLearning(member, null) !== null);

  // ---- 3. distill rules ----
  const ev = (type, payload, id) => ({ type, id: id || `e_${Math.random().toString(36).slice(2, 8)}`, at: "2026-01-01T00:00:00.000Z", payload });
  const mixed = [
    ev("wake.throttled", { from: "t/a/w/s" }, "e_t1"),
    ev("wake.throttled", { to: "x", from: "t/a/w/s" }, "e_t2"),
    ev("wake.denied", { from: "t/b/w/s", reason: "WAKE_CROSS_SCOPE", to: "u/c/w/s" }, "e_d1"),
    ev("discussion.resolved", { messageId: "d_1", topic: "deploy", from: "t/a/w/s" }, "e_r1"),
    ev("wake.delivered", { from: "t/a/w/s", to: "t/l/w/s", team: "t", topic: "verify", reason: "escalate" }, "e_e1"),
    ev("wake.delivered", { from: "t/a/w/s", to: "t/c/w/s", team: "t", topic: "verify", reason: "mention" }, "e_e2"),
    ev("session.learned", { outcome: "shipped", lessons: "batch nudges", threadRef: "deploy" }, "e_l1"),
    null,
    "junk",
    ev("phase.outcome", { decision: "advance" }, "e_p1"),
  ];
  const distilled = learn.distillLearnings(mixed);
  const kinds = distilled.map((c) => c.kind).sort();
  check("all five rules fire",
    JSON.stringify(kinds) === JSON.stringify(["escalation", "session-lesson", "thread-resolved", "wake-denied", "wake-throttle"].sort()),
    JSON.stringify(kinds));
  const throttle = distilled.find((c) => c.kind === "wake-throttle");
  check("throttle aggregates evidence", !!throttle && throttle.evidence.count === 2 && throttle.evidence.eventIds.length === 2);
  const denied = distilled.find((c) => c.kind === "wake-denied");
  check("denied names reason", !!denied && denied.lesson.indexOf("WAKE_CROSS_SCOPE") !== -1);
  const lesson = distilled.find((c) => c.kind === "session-lesson");
  check("session-lesson quotes verbatim", !!lesson && lesson.lesson === "shipped — batch nudges" && lesson.topic === "deploy");
  check("mention wakes distill nothing", !distilled.some((c) => (c.evidence.eventIds || []).indexOf("e_e2") !== -1));
  check("candidates pending", distilled.every((c) => c.status === "pending" && typeof c.id === "string"));
  check("distill junk-proof", Array.isArray(learn.distillLearnings(null)) && learn.distillLearnings(null).length === 0);

  // ---- 4. distillAndSave ----
  const before = learn.distillAndSave(mixed, artifactDir);
  check("distillAndSave persists", before.length === distilled.length && fs.existsSync(path.join(artifactDir, "learn-candidates.json")));
  const again = learn.distillAndSave(mixed, artifactDir);
  check("distillAndSave merges additive", again.length === distilled.length * 2);
  check("loadCandidates reads back", learn.loadCandidates(artifactDir).length === again.length);
  check("loadCandidates junk-proof", learn.loadCandidates(path.join(artifactDir, "missing")).length === 0);
  // ring cap: 100 rows max
  for (let i = 0; i < 30; i++) learn.distillAndSave(mixed, artifactDir);
  const capped = learn.loadCandidates(artifactDir);
  check("candidates ring-capped", capped.length === learn.LEARN_CAP, String(capped.length));

  // ---- 5. approve gate ----
  const target = capped[0];
  check("approve without identity refused",
    learn.approveCandidate(artifactDir, target.id, {}).code === "LEARNING_NEEDS_HUMAN" &&
    learn.approveCandidate(artifactDir, target.id, { decision: "approved" }).code === "LEARNING_NEEDS_HUMAN" &&
    learn.approveCandidate(artifactDir, target.id, { decision: "maybe", by: "peter" }).code === "LEARNING_NEEDS_HUMAN");
  check("refused approve writes nothing",
    learn.loadCandidates(artifactDir).find((c) => c.id === target.id).status === "pending");
  const marker = path.join(artifactDir, "marker.txt");
  fs.writeFileSync(marker, "untouched", "utf8");
  const approved = learn.approveCandidate(artifactDir, target.id, { decision: "approved", by: "peter" });
  check("approve flips with stamp",
    approved.ok === true && approved.candidate.status === "approved" &&
    approved.candidate.decidedBy === "peter" && !!approved.candidate.decidedAt, JSON.stringify(approved.candidate));
  const rejected = learn.approveCandidate(artifactDir, capped[1].id, { decision: "rejected", by: "peter" });
  check("reject flips", rejected.ok === true && rejected.candidate.status === "rejected");
  check("double-decide refused", learn.approveCandidate(artifactDir, target.id, { decision: "rejected", by: "peter" }).code === "LEARNING_UNKNOWN");
  check("unknown id refused", learn.approveCandidate(artifactDir, "lc_missing", { decision: "approved", by: "peter" }).code === "LEARNING_UNKNOWN");
  check("approve never auto-applies (no source touched)", fs.readFileSync(marker, "utf8") === "untouched");

  // ---- 6. CLI learning record/distill/approve + gate exits ----
  const runCli = (cmd, extraEnv) => cp.execSync(cmd, {
    cwd: ROOT, encoding: "utf8", env: Object.assign({}, process.env, extraEnv),
  });
  const runCliStatus = (cmd, extraEnv) => {
    try {
      runCli(cmd, extraEnv);
      return 0;
    } catch (err) {
      return typeof err.status === "number" ? err.status : 1;
    }
  };
  const cliWs = mkWorkspace("proj-cli-learn");
  const cliArtifact = fs.mkdtempSync(path.join(os.tmpdir(), "learn-cli-artifact-"));
  const cliEnv = { PCORE_STATE_DIR: stateDir, PCORE_CONDUCTOR_STATE_DIR: conductorDir, PCORE_ARTIFACT_DIR: cliArtifact, PCORE_WORKSPACE_ROOT: cliWs, PCORE_SESSION_ID: "sess-cli-learn" };
  runCli(`bash scripts/team-sessions.sh claim --member Cleo --team Team-See --json`, cliEnv);
  const recCli = JSON.parse(runCli(`bash scripts/team-sessions.sh learning record --member Cleo --team Team-See --lessons "batch nudges" --outcome shipped --thread deploy --json`, cliEnv));
  check("CLI learning record stores session.learned",
    recCli.type === "session.learned" && recCli.payload.lessons === "batch nudges" && recCli.payload.threadRef === "deploy",
    JSON.stringify(recCli.payload).slice(0, 160));
  const distCli = JSON.parse(runCli(`bash scripts/team-sessions.sh learning distill --json`, cliEnv));
  check("CLI learning distill writes artifact dir",
    distCli.dir === cliArtifact && distCli.count >= 1 && fs.existsSync(path.join(cliArtifact, "learn-candidates.json")));
  const candId = distCli.candidates[distCli.candidates.length - 1].id;
  check("CLI approve gate exits 2 without human",
    runCliStatus(`bash scripts/team-sessions.sh learning approve --id ${candId} --json`, cliEnv) === 2);
  const apprCli = JSON.parse(runCli(`bash scripts/team-sessions.sh learning approve --id ${candId} --decision approved --by peter --json`, cliEnv));
  check("CLI approve flips with human", apprCli.status === "approved" && apprCli.decidedBy === "peter");
  try { fs.rmSync(cliArtifact, { recursive: true, force: true }); } catch { /* ignore */ }

  // ---- 7. no .tmp residue ----
  const leftovers = [];
  const sweep = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) sweep(p);
      else if (e.name.indexOf(".tmp.") !== -1) leftovers.push(p);
    }
  };
  sweep(stateDir);
  sweep(artifactDir);
  check("no .tmp residue", leftovers.length === 0, leftovers.join(","));
} finally {
  try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(conductorDir, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(artifactDir, { recursive: true, force: true }); } catch { /* ignore */ }
  delete process.env.PCORE_STATE_DIR;
  delete process.env.PCORE_CONDUCTOR_STATE_DIR;
}

if (failed) {
  console.log(`\nFAIL (${failed} checks)`);
  process.exit(1);
}
console.log("\nPASS (all checks)");
