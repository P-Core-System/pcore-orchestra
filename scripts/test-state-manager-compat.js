#!/usr/bin/env node
"use strict";

/**
 * Self-check: saveState(session) overload + loadState session vs loadRootState root.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orchestra-state-"));
const sm = require("../bundle/hooks/lib/state-manager.js");

let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

try {
  process.env.PCORE_SESSION_ID = "test-compat-session";

  const session = {
    ...sm.DEFAULT_SESSION_STATE,
    active: true,
    goal: "compat check",
    currentPhase: "plan",
    phase: "plan",
  };

  // saveState(sessionObject) without rootDir must not TypeError (old bug: path.join(Object))
  const origWrite = fs.writeFileSync;
  const origMkdir = fs.mkdirSync;
  let wrotePath = null;
  fs.writeFileSync = (p) => {
    wrotePath = p;
  };
  fs.mkdirSync = () => {};
  let threw = null;
  try {
    sm.saveState(session);
  } catch (e) {
    threw = e;
  } finally {
    fs.writeFileSync = origWrite;
    fs.mkdirSync = origMkdir;
  }
  check("saveState(session) does not throw", !threw, threw && threw.message);
  check("saveState(session) targets a string path", typeof wrotePath === "string");

  // Persist into temp project tree via rootDir string
  const projectRoot = path.join(tmp, "proj");
  fs.mkdirSync(path.join(projectRoot, ".cursor", "hooks", "state"), { recursive: true });
  session.goal = "temp-root goal";
  sm.saveState(projectRoot, session, "test-compat-session");

  const loaded = sm.loadState(projectRoot, "test-compat-session");
  check(
    "loadState returns session with .active",
    loaded && loaded.active === true,
    JSON.stringify(loaded && { active: loaded.active, goal: loaded.goal })
  );
  check("loadState session has .goal", loaded && loaded.goal === "temp-root goal");

  const root = sm.loadRootState(projectRoot, "test-compat-session");
  check("loadRootState returns .sessions", root && root.sessions && typeof root.sessions === "object");
  check(
    "loadRootState.sessions[sid] matches",
    root.sessions["test-compat-session"] &&
      root.sessions["test-compat-session"].goal === "temp-root goal"
  );

  // Flat→sessions migrate
  const flatPath = path.join(projectRoot, ".cursor", "hooks", "state", "orchestra.json");
  fs.writeFileSync(
    flatPath,
    JSON.stringify({ version: 3, active: false, goal: "flat-legacy", currentPhase: "idle" }, null, 2)
  );
  const migratedRoot = sm.loadRootState(projectRoot, "test-compat-session");
  check(
    "flat disk migrates to sessions",
    !!(migratedRoot.sessions && Object.keys(migratedRoot.sessions).length)
  );
  const flatSession = sm.loadState(projectRoot, "test-compat-session");
  check("loadState after flat migrate has .active", typeof flatSession.active === "boolean");

  check("DEFAULT_STATE aliases DEFAULT_SESSION_STATE", sm.DEFAULT_STATE === sm.DEFAULT_SESSION_STATE);
} finally {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

if (failed) {
  console.log(`\nFAIL (${failed} checks)`);
  process.exit(1);
}
console.log("\nPASS (all checks)");
