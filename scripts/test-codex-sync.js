"use strict";

/**
 * Tests for scripts/sync-codex-agents.js — flat TOML custom-agent mirror.
 */

const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const SYNC = path.join(ROOT, "scripts", "sync-codex-agents.js");
const SRC = path.join(ROOT, "bundle", "agents");
const DEST = path.join(ROOT, "bundle", "codex", "agents");

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
}

function walk(dir, ext, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, ext, files);
    else if (entry.name.endsWith(ext)) files.push(full);
  }
  return files;
}

function runSync() {
  return execFileSync(process.execPath, [SYNC], { cwd: ROOT, encoding: "utf8" });
}

function treeHashes(dir) {
  const hashes = {};
  for (const file of walk(dir, ".toml")) {
    const rel = path.relative(dir, file).split(path.sep).join("/");
    hashes[rel] = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  }
  return hashes;
}

function field(raw, name) {
  const m = raw.match(new RegExp(`^${name}\\s*=\\s*(.+)$`, "m"));
  return m ? m[1] : null;
}

function runTests() {
  console.log("=== test-codex-sync.js ===");
  let passed = 0;
  let failed = 0;

  // Test 1: sync runs and produces the conductor agent
  try {
    runSync();
    assert(fs.existsSync(path.join(DEST, "orchestra.toml")), "bundle/codex/agents/orchestra.toml exists after sync");
    passed++;
  } catch (e) {
    console.log(`  ✗ sync run: ${e.message}`);
    failed++;
  }

  // Test 2: planner TOML fields and developer_instructions body
  try {
    const raw = fs.readFileSync(path.join(DEST, "orchestra-planner.toml"), "utf8");
    assert(field(raw, "name") === '"orchestra-planner"', "planner name is a TOML string");
    const desc = field(raw, "description");
    assert(typeof desc === "string" && desc.startsWith('"') && desc.endsWith('"') && desc.length > 2, "planner description is a TOML string");
    assert(raw.includes("developer_instructions = '''\n"), "planner uses a multi-line literal string");
    assert(raw.includes("You are the **orchestra planner** subagent."), "developer_instructions preserves the agent body");
    assert(!/^model\s*=/m.test(raw), "no per-agent model (inherits session)");
    assert(!/^readonly\s*=/m.test(raw), "no readonly key in TOML");
    passed += 7;
  } catch (e) {
    console.log(`  ✗ planner conversion: ${e.message}`);
    failed++;
  }

  // Test 3: flat mirror and count parity with the source tree
  try {
    const srcCount = walk(SRC, ".md").filter((f) => !path.relative(SRC, f).startsWith("references" + path.sep)).length;
    const destFiles = walk(DEST, ".toml");
    const nested = destFiles.filter((f) => path.dirname(f) !== DEST);
    assert(nested.length === 0, "mirror is flat (Codex keys agents by name)");
    assert(destFiles.length === srcCount, `generated agent count (${destFiles.length}) == source agent count (${srcCount})`);
    const names = destFiles.map((f) => path.basename(f, ".toml"));
    assert(new Set(names).size === names.length, "agent basenames are unique");
    passed += 3;
  } catch (e) {
    console.log(`  ✗ mirror shape: ${e.message}`);
    failed++;
  }

  // Test 4: idempotency — second run produces zero content changes
  try {
    const before = treeHashes(DEST);
    runSync();
    const after = treeHashes(DEST);
    assert(JSON.stringify(before) === JSON.stringify(after), "second sync run produces no content changes");
    passed++;
  } catch (e) {
    console.log(`  ✗ idempotency: ${e.message}`);
    failed++;
  }

  // Test 5: --check exits 0 on a synced tree and 1 on drift
  try {
    execFileSync(process.execPath, [SYNC, "--check"], { cwd: ROOT, encoding: "utf8" });
    assert(true, "--check passes on synced tree");
    const target = path.join(DEST, "orchestra-planner.toml");
    const original = fs.readFileSync(target, "utf8");
    try {
      fs.writeFileSync(target, original + "\n# drift\n");
      let exitCode = 0;
      try {
        execFileSync(process.execPath, [SYNC, "--check"], { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
      } catch (e) {
        exitCode = e.status;
      }
      assert(exitCode === 1, "--check exits 1 on drift");
    } finally {
      fs.writeFileSync(target, original);
    }
    passed += 2;
  } catch (e) {
    console.log(`  ✗ --check: ${e.message}`);
    failed++;
  }

  // Test 6: every generated TOML parses (python3 tomllib when available)
  try {
    let canParse = false;
    try {
      execFileSync("python3", ["-c", "import tomllib"], { stdio: "pipe" });
      canParse = true;
    } catch {}
    if (canParse) {
      const files = walk(DEST, ".toml");
      execFileSync(
        "python3",
        ["-c", "import sys,tomllib\nfor p in sys.argv[1:]:\n    with open(p,'rb') as f: tomllib.load(f)", ...files],
        { encoding: "utf8", stdio: "pipe", maxBuffer: 16 * 1024 * 1024 }
      );
      assert(true, `all ${files.length} TOML files parse with tomllib`);
    } else {
      console.log("  (python3 tomllib unavailable — skipping TOML parse)");
    }
    passed++;
  } catch (e) {
    console.log(`  ✗ TOML parse: ${e.message}`);
    failed++;
  }

  // Test 7 (#38): no generated TOML may carry Cursor-specific model / spawn guidance.
  try {
    const files = walk(DEST, ".toml");
    // Phrases that are Cursor/OpenCode model-pool or spawn guidance and must be gone.
    const forbidden = [
      [/composer-2\.5/i, "composer-2.5"],
      [/Cursor\s+Models/i, "Cursor Models"],
      [/Cursor\s+Agent/i, "Cursor Agent"],
      [/Cursor\s+Task/i, "Cursor Task"],
      [/grok-4\.6/i, "grok-4.6"],
      [/Other\s+Models/i, "Other Models"],
    ];
    const offenders = [];
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      for (const [re, label] of forbidden) {
        if (re.test(text)) offenders.push(`${path.basename(file)}: ${label}`);
      }
    }
    assert(offenders.length === 0, `no TOML carries Cursor model/spawn guidance (${files.length} scanned)${offenders.length ? " — offenders: " + offenders.slice(0, 5).join(", ") : ""}`);
    // And each must expose the Codex-neutral model note instead.
    const missingNote = files.filter((f) => !fs.readFileSync(f, "utf8").includes("Codex uses the model configured for the session"));
    assert(missingNote.length === 0, `every TOML has the Codex model note${missingNote.length ? " — missing: " + missingNote.slice(0, 5).map((f) => path.basename(f)).join(", ") : ""}`);
    passed += 2;
  } catch (e) {
    console.log(`  ✗ cursor-guidance strip: ${e.message}`);
    failed++;
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
