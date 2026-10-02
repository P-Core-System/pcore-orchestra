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
  const origRename = fs.renameSync;
  let wrotePath = null;
  fs.writeFileSync = (p) => {
    wrotePath = p;
  };
  fs.mkdirSync = () => {};
  fs.renameSync = () => {};
  let threw = null;
  try {
    sm.saveState(session);
  } catch (e) {
    threw = e;
  } finally {
    fs.writeFileSync = origWrite;
    fs.mkdirSync = origMkdir;
    fs.renameSync = origRename;
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

  // --- Phase 1: safe-write migration ---
  const sw = require("../bundle/hooks/lib/safe-write.js");

  // (a) PCORE_STATE_DIR override redirects every state write
  const stateDir = path.join(tmp, "statedir");
  fs.mkdirSync(stateDir, { recursive: true });
  process.env.PCORE_STATE_DIR = stateDir;
  try {
    const envSession = {
      ...sm.DEFAULT_SESSION_STATE,
      active: true,
      goal: "env override goal",
      currentPhase: "implement",
      phase: "implement",
    };
    sm.saveState(envSession, "env-sid");
    const envFile = path.join(stateDir, "orchestra.json");
    check("PCORE_STATE_DIR override writes <dir>/orchestra.json", fs.existsSync(envFile), JSON.stringify(fs.readdirSync(stateDir)));
    check(
      "PCORE_STATE_DIR state round-trips",
      sm.loadState(null, "env-sid").goal === "env override goal"
    );

    // (b) saveState observed going through a tmp file + rename (atomic)
    const origWrite = fs.writeFileSync;
    const origRename = fs.renameSync;
    const writes = [];
    const renames = [];
    fs.writeFileSync = function (p, ...rest) {
      writes.push(String(p));
      return origWrite.call(fs, p, ...rest);
    };
    fs.renameSync = function (a, b) {
      renames.push([String(a), String(b)]);
      return origRename.call(fs, a, b);
    };
    try {
      envSession.goal = "tmp+rename";
      sm.saveState(envSession, "env-sid");
    } finally {
      fs.writeFileSync = origWrite;
      fs.renameSync = origRename;
    }
    check("saveState writes through a .tmp file", writes.some((p) => /\.tmp\./.test(p)), JSON.stringify(writes));
    check(
      "saveState renames tmp -> orchestra.json",
      renames.some(([a, b]) => /\.tmp\./.test(a) && b.replace(/\\/g, "/").endsWith("orchestra.json")),
      JSON.stringify(renames)
    );
    check(
      "no .tmp residue after saveState",
      fs.readdirSync(stateDir).filter((f) => f.includes(".tmp.")).length === 0,
      JSON.stringify(fs.readdirSync(stateDir))
    );

    // (c) updateState(mutator) holds the lock across load -> mutate -> save
    const lockFile = `${envFile}.lock`;
    let lockSeenDuringMutate = null;
    const updated = sm.updateState(
      (state) => {
        lockSeenDuringMutate = fs.existsSync(lockFile);
        state.goal = "updated under lock";
        return state;
      },
      { sessionId: "env-sid" }
    );
    check("updateState runs the mutator with the lock held", lockSeenDuringMutate === true, String(lockSeenDuringMutate));
    check("updateState releases the lock afterwards", !fs.existsSync(lockFile));
    check("updateState persists the mutation", sm.loadState(null, "env-sid").goal === "updated under lock", sm.loadState(null, "env-sid").goal);
    check("updateState returns the mutated session", updated && updated.goal === "updated under lock");

    // mutator returning null => no save, no lock leak
    const noopLock = sm.updateState(() => null, { sessionId: "env-sid" });
    check("updateState supports no-op (null) without leaking the lock", noopLock === null && !fs.existsSync(lockFile));
  } finally {
    delete process.env.PCORE_STATE_DIR;
  }

  // (d) corrupt orchestra.json -> quarantined sibling + defaults (never silent reset)
  const corruptRoot = path.join(tmp, "corrupt-proj");
  const corruptDir = path.join(corruptRoot, ".cursor", "hooks", "state");
  const corruptFile = path.join(corruptDir, "orchestra.json");
  fs.mkdirSync(corruptDir, { recursive: true });
  const corruptBytes = '{"version":3,"sessions":{"sid": ';
  fs.writeFileSync(corruptFile, corruptBytes);
  const corruptState = sm.loadState(corruptRoot, "corrupt-sid");
  check(
    "corrupt orchestra.json returns defaults",
    corruptState && corruptState.active === false && corruptState.currentPhase === "idle",
    JSON.stringify({ active: corruptState && corruptState.active, phase: corruptState && corruptState.currentPhase })
  );
  const quarantined = fs.readdirSync(corruptDir).filter((f) => /\.corrupt-\d+$/.test(f));
  check("corrupt orchestra.json quarantined to .corrupt-<ts>", quarantined.length === 1, JSON.stringify(fs.readdirSync(corruptDir)));
  check(
    "corrupt bytes preserved in quarantine (never silent reset)",
    quarantined.length === 1 && fs.readFileSync(path.join(corruptDir, quarantined[0]), "utf8") === corruptBytes
  );
  check("corrupt original removed", !fs.existsSync(corruptFile));
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
