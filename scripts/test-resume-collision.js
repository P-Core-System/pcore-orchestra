#!/usr/bin/env node
"use strict";

/**
 * Self-check for the resume-collision guard:
 *  1. fresh resumeRun creates a run ({ok:true, resumed:false})
 *  2. same holder resumeRun resumes ({ok:true, resumed:true})
 *  3. different holder resumeRun refuses ({ok:false, code:RESUME_COLLISION, holder})
 *  4. beginRun with mismatched expectedClaimKey refuses and writes nothing
 *  5. beginRun without the guard keeps legacy resume behavior
 *  6. legacy run with no holder identity resumes fail-open (no refusal)
 *  7. no .tmp.* residue after ops
 *
 * Uses explicit sessionId/workspace/taskId args and a temporary
 * PCORE_CONDUCTOR_STATE_DIR so the real home config is never touched.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const base = fs.mkdtempSync(path.join(os.tmpdir(), "resume-collision-"));

process.env.PCORE_CONDUCTOR_STATE_DIR = base;
delete process.env.PCORE_TASK_ID;
delete process.env.PCORE_WORKSPACE_ROOT;
delete process.env.PCORE_MEMBER_NAME;
delete process.env.PCORE_TEAM_NAME;
delete process.env.PCORE_MEMBER_ROLE;

const c = require("../bundle/hooks/lib/conductor-state.js");

let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function pathOf(run) {
  return path.join(base, run.workspaceSlug, run.sessionId, `${run.taskId}.json`);
}

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.lstatSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

try {
  check("RESUME_COLLISION exported", c.RESUME_COLLISION === "RESUME_COLLISION");
  check("resumeRun exported", typeof c.resumeRun === "function");
  check("holderOf exported", typeof c.holderOf === "function");

  // ---- 1. fresh resumeRun creates ----
  const fresh = c.resumeRun({ goal: "g1", phase: "plan", sessionId: "sess-a", workspace: "/tmp/wsA", taskId: "task-collide" });
  check("fresh resumeRun ok", fresh.ok === true, JSON.stringify(fresh.code || null));
  check("fresh resumeRun not resumed", fresh.resumed === false);
  check("fresh run file exists", fs.existsSync(pathOf(fresh.run)));
  const holderA = c.holderOf(fresh.run);
  check("fresh run has holder", typeof holderA === "string" && holderA.length > 0, String(holderA));

  // ---- 2. same holder resumes ----
  const again = c.resumeRun({ goal: "g1", phase: "plan", sessionId: "sess-a", workspace: "/tmp/wsA", taskId: "task-collide" });
  check("same holder resumeRun ok", again.ok === true);
  check("same holder resumed", again.resumed === true, `resumed=${again.resumed}`);
  check("same holder startedAt preserved", again.run.startedAt === fresh.run.startedAt);

  // ---- 3. different holder refused (same session+task, different member) ----
  process.env.PCORE_MEMBER_NAME = "intruder";
  const second = c.resumeRun({ goal: "g1", phase: "plan", sessionId: "sess-a", workspace: "/tmp/wsA", taskId: "task-collide" });
  check("different holder refused", second.ok === false, `ok=${second.ok}`);
  check("refusal code is RESUME_COLLISION", second.code === "RESUME_COLLISION", String(second.code));
  check("refusal names holder", second.holder === holderA, `${second.holder} vs ${holderA}`);

  // ---- 4. beginRun guard refuses and writes nothing ----
  const before = fs.readFileSync(pathOf(fresh.run), "utf8");
  const guarded = c.beginRun({ goal: "g1", phase: "plan", sessionId: "sess-a", workspace: "/tmp/wsA", taskId: "task-collide", expectedClaimKey: "-/intruder/wsa/sess-a" });
  check("beginRun guard refuses", guarded.ok === false && guarded.code === "RESUME_COLLISION", JSON.stringify(guarded.code || null));
  check("beginRun guard names holder", guarded.holder === holderA, `${guarded.holder} vs ${holderA}`);
  check("guard writes nothing", fs.readFileSync(pathOf(fresh.run), "utf8") === before);
  delete process.env.PCORE_MEMBER_NAME;

  // ---- 5. beginRun without guard keeps legacy resume ----
  const legacy = c.beginRun({ goal: "g1", phase: "plan", sessionId: "sess-a", workspace: "/tmp/wsA", taskId: "task-collide" });
  check("unguarded beginRun still resumes", legacy.run && legacy.resumed === true, `resumed=${legacy.resumed}`);
  check("unguarded beginRun ok:true", legacy.ok === true);

  // ---- 6. legacy run with no holder identity resumes fail-open ----
  const bare = c.beginRun({ goal: "bare", phase: "plan", sessionId: "sess-bare", workspace: "/tmp/wsB", taskId: "task-bare" });
  delete bare.run.claimKey;
  delete bare.run.memberDisplay;
  c.saveRun(bare.run);
  const bareResume = c.resumeRun({ goal: "bare", phase: "plan", sessionId: "sess-other", workspace: "/tmp/wsB", taskId: "task-bare" });
  check("holderless run resumes fail-open", bareResume.ok === true && bareResume.run, `ok=${bareResume.ok}`);

  // ---- 7. no .tmp.* residue ----
  const residue = walk(base).filter((f) => f.indexOf(".tmp.") !== -1);
  check("no .tmp.* residue", residue.length === 0, JSON.stringify(residue));
} finally {
  try {
    fs.rmSync(base, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  delete process.env.PCORE_CONDUCTOR_STATE_DIR;
}

if (failed) {
  console.log(`\nFAIL (${failed} checks)`);
  process.exit(1);
}
console.log("\nPASS (all checks)");
