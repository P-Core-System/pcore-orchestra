"use strict";

/**
 * Hybrid memory retrieval: SQLite FTS5 (node:sqlite) fused with the JSON
 * token index via reciprocal rank fusion. FTS is strictly best-effort —
 * everything must keep working when node:sqlite is absent or the state dir
 * is unwritable.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "bundle");

function loadFts() {
  const modPath = path.join(ROOT, "hooks", "lib", "memory-fts.js");
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
}

function loadIndex() {
  const modPath = path.join(ROOT, "hooks", "lib", "memory-index.js");
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
}

function loadManager() {
  const modPath = path.join(ROOT, "hooks", "lib", "memory-manager.js");
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
}

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    console.log(`  PASS ${name}`);
    passed++;
  } else {
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function freshTmpState() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "orch-fts-"));
}

function main() {
  console.log("=== test-memory-hybrid.js ===");

  const stateDir = freshTmpState();
  process.env.PCORE_STATE_DIR = stateDir;

  const fts = loadFts();
  const memIdx = loadIndex();

  // ── 1. availability + exports ────────────────────────────────────
  check("memory-fts.js exports ftsAvailable", typeof fts.ftsAvailable === "function");
  check("memory-fts.js exports indexGoalFts", typeof fts.indexGoalFts === "function");
  check("memory-fts.js exports searchFts", typeof fts.searchFts === "function");
  check("memory-fts.js exports removeFts", typeof fts.removeFts === "function");
  check("FTS is available under this Node", fts.ftsAvailable() === true, `got ${fts.ftsAvailable()}`);

  // ── 2. dual write: JSON index + FTS mirror ───────────────────────
  const goalA = { goal: "Add rate limiting to the payments API", outcome: "completed", lessons: ["use token bucket", "avoid nginx config drift"] };
  const goalB = { goal: "Refactor the payments dashboard charts", outcome: "completed", lessons: ["reuse chart theme tokens"] };
  const goalC = { goal: "Fix flaky session claims test on Windows", outcome: "failed", lessons: [] };

  const idA = memIdx.indexCompletedGoal(goalA, "2026-10-01T00:00:00.000Z");
  const idB = memIdx.indexCompletedGoal(goalB, "2026-10-02T00:00:00.000Z");
  const idC = memIdx.indexCompletedGoal(goalC, "2026-10-03T00:00:00.000Z");
  check("indexCompletedGoal still returns ids", [idA, idB, idC].every((id) => typeof id === "string" && id.startsWith("g-")));

  const ftsRows = fts.searchFts("payments rate limiting", 5);
  check("searchFts finds the dual-written goal", ftsRows.length > 0 && ftsRows[0].entryId === idA, JSON.stringify(ftsRows));
  check("searchFts scores are positive numbers", ftsRows.every((r) => typeof r.score === "number" && r.score > 0));

  const ftsEmpty = fts.searchFts("zzzzqqqq nonexistenttoken", 5);
  check("searchFts returns [] for a no-match query", Array.isArray(ftsEmpty) && ftsEmpty.length === 0, JSON.stringify(ftsEmpty));

  const ftsBlank = fts.searchFts("", 5);
  check("searchFts returns [] for an empty query", ftsBlank.length === 0);

  // ── 3. hybrid search API unchanged ───────────────────────────────
  const hybrid = memIdx.searchMemoryIndex("payments rate limiting token bucket", 5);
  check("searchMemoryIndex returns array of entries", Array.isArray(hybrid) && hybrid.length > 0);
  check("hybrid result carries goal + score", hybrid[0].goal === goalA.goal && typeof hybrid[0].score === "number", JSON.stringify(hybrid[0]));
  check("hybrid result exposes source ranks", Array.isArray(hybrid[0].sources) && hybrid[0].sources.includes("fts"), JSON.stringify(hybrid[0].sources));

  const hybridDeterministic = memIdx.searchMemoryIndex("payments rate limiting token bucket", 5);
  check(
    "hybrid ranking is deterministic",
    JSON.stringify(hybrid.map((r) => r.id)) === JSON.stringify(hybridDeterministic.map((r) => r.id))
  );

  // Entry matching both signals must outrank an entry matching only one.
  const mixed = memIdx.searchMemoryIndex("payments rate limiting token bucket", 5);
  const idsMixed = mixed.map((r) => r.id);
  check("both-source entry outranks single-source", idsMixed[0] === idA && idsMixed.indexOf(idA) < idsMixed.indexOf(idB), JSON.stringify(idsMixed));

  const noQuery = memIdx.searchMemoryIndex("   ", 5);
  check("searchMemoryIndex returns [] for whitespace query", noQuery.length === 0);

  // ── 4. pruning keeps FTS in sync with the JSON index ─────────────
  const removed = fts.removeFts([idC]);
  check("removeFts reports success", removed === true, `got ${removed}`);
  const afterRemove = fts.searchFts("flaky session claims Windows", 5);
  check("pruned goal is gone from FTS", afterRemove.every((r) => r.entryId !== idC), JSON.stringify(afterRemove));

  // ── 5. fail-open when the state dir is unusable ─────────────────
  const brokenDir = path.join(stateDir, "not-a-dir");
  fs.writeFileSync(brokenDir, "x");
  process.env.PCORE_STATE_DIR = brokenDir;
  const ftsBroken = loadFts();
  const memIdxBroken = loadIndex();
  check("ftsAvailable() is false when the DB cannot open", ftsBroken.ftsAvailable() === false);
  check("indexGoalFts fails open (false)", ftsBroken.indexGoalFts("g-x", goalA, "2026-10-04T00:00:00.000Z") === false);
  check("searchFts fails open ([])", ftsBroken.searchFts("payments", 5).length === 0);
  const jsonOnly = memIdxBroken.searchMemoryIndex("nonexistent-in-json", 5);
  check("searchMemoryIndex degrades to JSON-only without throwing", Array.isArray(jsonOnly));

  // ── 6. explicit kill switch ──────────────────────────────────────
  process.env.PCORE_STATE_DIR = stateDir;
  process.env.PCORE_FTS_DISABLE = "1";
  const ftsDisabled = loadFts();
  check("PCORE_FTS_DISABLE turns FTS off", ftsDisabled.ftsAvailable() === false);
  const memIdxDisabled = loadIndex();
  const jsonOnly2 = memIdxDisabled.searchMemoryIndex("payments rate limiting", 5);
  check("search still works with FTS disabled", jsonOnly2.length > 0 && jsonOnly2[0].sources.includes("json"));
  delete process.env.PCORE_FTS_DISABLE;

  // ── 7. memory-manager wiring intact ──────────────────────────────
  const memMgr = loadManager();
  check("memory-manager exports buildMemoryContext", typeof memMgr.buildMemoryContext === "function");
  const memoryState = {
    version: 1,
    sessions: {
      "s-test": {
        completed_goals: [
          { goal: goalB.goal, outcome: goalB.outcome, duration_ms: 900000, lessons: goalB.lessons, timestamp: "2026-10-02T00:00:00.000Z", phase_count: 1 },
        ],
        recent_files: [],
        error_patterns: [],
        plan_outcomes: [],
      },
    },
  };
  const ctx = memMgr.buildMemoryContext(memoryState, { query: "payments dashboard charts" });
  check("buildMemoryContext still emits index-search block", typeof ctx === "string" && ctx.includes("index search"), ctx.slice(0, 160));

  // ── 8. mirrors byte-identical ────────────────────────────────────
  for (const rel of ["memory-fts.js", "memory-index.js"]) {
    const cursor = path.join(ROOT, "hooks", "lib", rel);
    const opencode = path.join(ROOT, "opencode", "hooks", "lib", rel);
    const same = fs.readFileSync(cursor).equals(fs.readFileSync(opencode));
    check(`${rel} mirrored byte-identically`, same);
  }

  fs.rmSync(stateDir, { recursive: true, force: true });

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
