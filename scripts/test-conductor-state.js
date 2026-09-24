#!/usr/bin/env node
"use strict";

/**
 * Self-check for bundle/hooks/lib/conductor-state.js run isolation:
 *  1. two sessions -> separate run files, index lists both
 *  2. same session+task resumes same file, preserves startedAt
 *  3. index reflects active runs (listRuns / activeSessionIds)
 *  4. stale detection (isStale + findStale)
 *  5. legacy one-time migrate (reads + renames once, never re-read)
 *  6. no .tmp.* residue after ops
 *
 * Uses explicit sessionId/workspace args and a temporary PCORE_CONDUCTOR_STATE_DIR
 * so the real home config is never touched.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const base = fs.mkdtempSync(path.join(os.tmpdir(), "conductor-state-"));
const legacyDir = path.join(base, "legacy");

process.env.PCORE_CONDUCTOR_STATE_DIR = base;
process.env.PCORE_LEGACY_STATE_PATH = path.join(legacyDir, "orchestra-state.json");
delete process.env.PCORE_TASK_ID;
delete process.env.PCORE_WORKSPACE_ROOT;

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

try {
  // ---- 1. two sessions -> separate run files, index lists both ----
  const a = c.beginRun({ goal: "g1", phase: "plan", sessionId: "sess-a", workspace: "/tmp/wsA" });
  const b = c.beginRun({ goal: "g2", phase: "plan", sessionId: "sess-b", workspace: "/tmp/wsA" });
  check("two sessions -> two distinct run files",
    pathOf(a.run) !== pathOf(b.run),
    `${pathOf(a.run)} vs ${pathOf(b.run)}`);
  check("sess-a run file exists", fs.existsSync(pathOf(a.run)));
  check("sess-b run file exists", fs.existsSync(pathOf(b.run)));
  const idx = c.loadIndex();
  const idxKeys = Object.keys(idx.runs);
  check("index lists both sessions",
    idxKeys.length === 2 &&
      idx.runs[`wsa/${a.run.sessionId}/${a.run.taskId}`] &&
      idx.runs[`wsa/${b.run.sessionId}/${b.run.taskId}`],
    JSON.stringify(idxKeys));

  // ---- 2. same session+task resumes same file, preserves startedAt ----
  const first = c.beginRun({ goal: "resume-goal", phase: "plan", sessionId: "sess-r", workspace: "/tmp/wsR", taskId: "task-r" });
  const second = c.beginRun({ goal: "resume-goal", phase: "plan", sessionId: "sess-r", workspace: "/tmp/wsR", taskId: "task-r" });
  const samePath = pathOf(first.run) === pathOf(second.run);
  check("same session+task -> same file path", samePath);
  check("second begin resumes (not fresh)", second.resumed === true, `resumed=${second.resumed}`);
  check("startedAt preserved across resume", first.run.startedAt === second.run.startedAt,
    `${first.run.startedAt} vs ${second.run.startedAt}`);

  // ---- 3. index reflects active runs ----
  const active = c.activeSessionIds({ workspace: "/tmp/wsA" });
  check("listRuns active for wsA has sess-a + sess-b",
    active.includes("sess-a") && active.includes("sess-b"),
    JSON.stringify(active));
  const live = c.getRunBySession("sess-b", "/tmp/wsA");
  check("getRunBySession finds live sess-b", live && live.sessionId === "sess-b" && live.status === "active");

  // ---- 4. stale detection ----
  const staleAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const staleRun = {
    workspace: "/tmp/wsS", workspaceSlug: "ws-s", sessionId: "sess-stale",
    taskId: "task-stale", goal: "stale", phase: "plan", status: "active",
    startedAt: staleAt, lastHeartbeat: staleAt, completedAt: null, failReason: null,
    phaseResults: {}, resumeAttempts: {}, summary: null,
  };
  c.saveRun(staleRun);
  check("isStale true for old heartbeat", c.isStale(staleRun, 5 * 60 * 1000) === true);
  const found = c.findStale(5 * 60 * 1000);
  check("findStale finds planted stale run",
    found.some((e) => e.sessionId === "sess-stale"));
  const fresh = c.beginRun({ goal: "fresh", phase: "plan", sessionId: "sess-fresh", workspace: "/tmp/wsF" });
  check("isStale false for fresh run", c.isStale(fresh.run, 5 * 60 * 1000) === false);

  // ---- 5. legacy one-time migrate ----
  fs.mkdirSync(legacyDir, { recursive: true });
  const legacyPath = process.env.PCORE_LEGACY_STATE_PATH;
  fs.writeFileSync(legacyPath, JSON.stringify({ goal: "legacy-goal", current_phase: "plan" }));
  const mig = c.beginRun({ goal: "mig-goal", phase: "plan", sessionId: "sess-mig", workspace: "/tmp/wsM" });
  const legacy = mig.run.legacy;
  check("legacy stashed on run", !!legacy && !!legacy.data, JSON.stringify(legacy));
  check("legacy goal read", legacy && legacy.data && legacy.data.goal === "legacy-goal");
  check("legacy original renamed (gone)", !fs.existsSync(legacyPath));
  const renamedFiles = fs.readdirSync(legacyDir).filter((f) => f.includes(".migrated."));
  check("legacy *.migrated.* created once", renamedFiles.length === 1, JSON.stringify(renamedFiles));
  const mig2 = c.beginRun({ goal: "mig2-goal", phase: "plan", sessionId: "sess-mig2", workspace: "/tmp/wsM" });
  check("second begin does not re-read legacy",
    !mig2.run.legacy && renamedFiles.length === 1 &&
      fs.readdirSync(legacyDir).filter((f) => f.includes(".migrated.")).length === 1);

  // ---- 6. no .tmp.* residue ----
  const tmpResidue = walk(base).filter((f) => f.indexOf(".tmp.") !== -1);
  check("no .tmp.* residue", tmpResidue.length === 0, JSON.stringify(tmpResidue));

  // every run file parses
  let allParse = true;
  for (const f of walk(base).filter((f) => f.endsWith(".json"))) {
    try {
      JSON.parse(fs.readFileSync(f, "utf8"));
    } catch {
      allParse = false;
    }
  }
  check("all run JSON files parse", allParse);
} finally {
  try {
    fs.rmSync(base, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  delete process.env.PCORE_CONDUCTOR_STATE_DIR;
  delete process.env.PCORE_LEGACY_STATE_PATH;
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

if (failed) {
  console.log(`\nFAIL (${failed} checks)`);
  process.exit(1);
}
console.log("\nPASS (all checks)");