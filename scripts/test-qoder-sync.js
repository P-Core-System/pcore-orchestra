"use strict";

/**
 * Tests for scripts/sync-qoder-agents.js (Cursor → Qoder agent mirror).
 * Same assert-counter style as scripts/test-spawn-adapter.js.
 */

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const SYNC = path.join(ROOT, "scripts", "sync-qoder-agents.js");
const SRC = path.join(ROOT, "bundle", "agents");
const DEST = path.join(ROOT, "bundle", "qoder", "agents");

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
}

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.name.endsWith(".md")) files.push(full);
  }
  return files;
}

function splitFrontmatter(raw) {
  const lines = raw.split(/\r?\n/);
  if (lines[0].trim() !== "---") return { fm: null, body: raw };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) return { fm: null, body: raw };
  return { fm: lines.slice(1, end).join("\n"), body: lines.slice(end + 1).join("\n") };
}

/** Flat top-level frontmatter fields; block scalars folded to one string. */
function parseFmFields(fm) {
  const fields = {};
  const lines = fm.split("\n");
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1];
    const rest = m[2].trim();
    if (/^[>|]-?$/.test(rest)) {
      const chunk = [];
      i++;
      while (i < lines.length && /^(  |\t)/.test(lines[i])) {
        chunk.push(lines[i].replace(/^\s+/, ""));
        i++;
      }
      fields[key] = chunk.join(" ").replace(/\s+/g, " ").trim();
      continue;
    }
    if (rest === "true") fields[key] = true;
    else if (rest === "false") fields[key] = false;
    else fields[key] = rest.replace(/^["']|["']$/g, "");
    i++;
  }
  return fields;
}

function runSync() {
  return execFileSync(process.execPath, [SYNC], { cwd: ROOT, encoding: "utf8" });
}

function treeHashes(dir) {
  const hashes = {};
  for (const file of walk(dir)) {
    const rel = path.relative(dir, file).split(path.sep).join("/");
    hashes[rel] = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  }
  return hashes;
}

function runTests() {
  console.log("=== test-qoder-sync.js ===");
  let passed = 0;
  let failed = 0;

  // Test 1: sync runs and produces the conductor agent
  try {
    runSync();
    assert(fs.existsSync(path.join(DEST, "orchestra.md")), "bundle/qoder/agents/orchestra.md exists after sync");
    passed++;
  } catch (e) {
    console.log(`  ✗ sync run: ${e.message}`);
    failed++;
  }

  // Test 2: orchestra-planner frontmatter conversion
  try {
    const srcFm = parseFmFields(splitFrontmatter(fs.readFileSync(path.join(SRC, "orchestra-planner.md"), "utf8")).fm);
    const genPath = path.join(DEST, "orchestra-planner.md");
    const gen = splitFrontmatter(fs.readFileSync(genPath, "utf8"));
    assert(gen.fm !== null, "generated orchestra-planner.md has frontmatter");
    const genFm = parseFmFields(gen.fm);
    assert(genFm.name === "orchestra-planner", "generated planner has name: orchestra-planner");
    assert(typeof genFm.description === "string" && genFm.description.length > 0, "generated planner has description");
    assert(!/^readonly:/m.test(gen.fm), "generated planner drops readonly");
    assert(!/^steps:/m.test(gen.fm), "generated planner drops steps");
    assert(!/^model:/m.test(gen.fm), "generated planner does not emit model (inherits session)");
    const expectedTurns = parseInt(srcFm.steps, 10) || 200;
    assert(String(genFm.maxTurns) === String(expectedTurns), `generated planner maxTurns matches source steps (${expectedTurns})`);
    passed += 7;
  } catch (e) {
    console.log(`  ✗ planner conversion: ${e.message}`);
    failed++;
  }

  // Test 3: readonly source → disallowedTools with Write/Edit/NotebookEdit
  try {
    const srcFm = parseFmFields(splitFrontmatter(fs.readFileSync(path.join(SRC, "00-business", "business-strategist.md"), "utf8")).fm);
    assert(srcFm.readonly === true, "source business-strategist is readonly: true");
    const genFmRaw = splitFrontmatter(fs.readFileSync(path.join(DEST, "00-business", "business-strategist.md"), "utf8")).fm;
    const m = genFmRaw.match(/^disallowedTools:\s*\[(.*)\]$/m);
    assert(m !== null, "generated business-strategist has disallowedTools list");
    const tools = m[1].split(",").map((s) => s.trim());
    assert(tools.includes("Write") && tools.includes("Edit"), "disallowedTools contains Write and Edit");
    assert(tools.includes("NotebookEdit"), "disallowedTools contains NotebookEdit");
    assert(!tools.includes("Bash"), "Bash stays allowed for readonly agents");
    passed += 5;
  } catch (e) {
    console.log(`  ✗ readonly conversion: ${e.message}`);
    failed++;
  }

  // Test 4: agent count parity. Conscious deviation from sync-opencode-agents.js
  // (which skips orchestra.md and protects core agents): Qoder has no separate
  // primary-agent mechanism, so the sync converts ALL agents including core.
  try {
    const srcCount = walk(SRC).filter((f) => !path.relative(SRC, f).startsWith("references" + path.sep)).length;
    const destCount = walk(DEST).filter((f) => !path.relative(DEST, f).startsWith("references" + path.sep)).length;
    assert(srcCount === destCount, `generated agent count (${destCount}) == source agent count (${srcCount})`);
    passed++;
  } catch (e) {
    console.log(`  ✗ agent count: ${e.message}`);
    failed++;
  }

  // Test 5: idempotency — second run produces zero file changes
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

  // Test 6: every generated description ≤ 1024 chars
  try {
    let checked = 0;
    let tooLong = [];
    for (const file of walk(DEST)) {
      if (path.relative(DEST, file).startsWith("references" + path.sep)) continue;
      const gen = splitFrontmatter(fs.readFileSync(file, "utf8"));
      if (!gen.fm) continue;
      const fields = parseFmFields(gen.fm);
      checked++;
      if (typeof fields.description !== "string" || fields.description.length > 1024) tooLong.push(path.relative(DEST, file));
    }
    assert(tooLong.length === 0, `all ${checked} generated descriptions ≤ 1024 chars`);
    passed++;
  } catch (e) {
    console.log(`  ✗ description limit: ${e.message}`);
    failed++;
  }

  // Test 7: --check exits 0 on a synced tree and 1 on drift
  try {
    execFileSync(process.execPath, [SYNC, "--check"], { cwd: ROOT, encoding: "utf8" });
    assert(true, "--check passes on synced tree");
    const target = path.join(DEST, "orchestra-planner.md");
    const original = fs.readFileSync(target, "utf8");
    try {
      fs.writeFileSync(target, original + "\n<!-- drift -->\n");
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

  // Test 5: Qoder hook event surface — payload normalization, stable session,
  // host detection, and spawn shape across two hook processes.
  try {
    const io = require(path.join(ROOT, "bundle", "hooks", "lib", "io.js"));
    const sm = require(path.join(ROOT, "bundle", "hooks", "lib", "state-manager.js"));

    const mapped = io.normalizeHookInput({ agent_type: "orchestra-planner" });
    assert(mapped.subagent_type === "orchestra-planner", "agent_type normalizes to subagent_type");

    const sessionKeys = ["PCORE_SESSION_ID", "OPENCODE_SESSION_ID", "CLAUDE_SESSION_ID", "CURSOR_TRACE_ID", "QODER_SESSION_ID", "QODER_PID"];
    const convEnv = {};
    for (const k of sessionKeys) {
      convEnv[k] = process.env[k];
      delete process.env[k];
    }
    try {
      io.normalizeHookInput({ conversation_id: "conv-cursor-1" });
      assert(process.env.PCORE_SESSION_ID === "conv-cursor-1", "Cursor conversation_id seeds the shared session");
    } finally {
      for (const [k, v] of Object.entries(convEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }

    const savedEnv = {};
    for (const k of sessionKeys) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    try {
      process.env.QODER_PID = "424242";
      assert(sm.getSessionId() === "424242", "Qoder falls back to QODER_PID when no session id");
      process.env.CURSOR_TRACE_ID = "cursor-trace";
      assert(sm.getSessionId() === "cursor-trace", "native Cursor trace id outranks Qoder env");
    } finally {
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qoder-hook-"));
    const ws = path.join(tmp, "ws");
    const stateDir = path.join(tmp, "state");
    fs.mkdirSync(ws, { recursive: true });
    const env = { ...process.env, PCORE_STATE_DIR: stateDir, QODER_CLI: "1", QODER_PID: "777777" };
    delete env.CURSOR_TRACE_ID;
    delete env.OPENCODE_SESSION_ID;
    delete env.CLAUDE_SESSION_ID;
    delete env.PCORE_SESSION_ID;

    execFileSync(process.execPath, [path.join(ROOT, "bundle", "hooks", "orchestra-prompt.js")], {
      cwd: ws,
      input: JSON.stringify({ prompt: "fix login bug", cwd: ws }),
      env,
      encoding: "utf8",
      stdio: "pipe",
    });
    const stopOut = execFileSync(process.execPath, [path.join(ROOT, "bundle", "hooks", "orchestra-subagent-stop.js")], {
      cwd: ws,
      input: JSON.stringify({ status: "completed", agent_type: "orchestra-planner", cwd: ws, summary: "PLAN_READY" }),
      env,
      encoding: "utf8",
      stdio: "pipe",
    });
    const root = JSON.parse(fs.readFileSync(path.join(stateDir, "orchestra.json"), "utf8"));
    const session = root.sessions["777777"];
    assert(Boolean(session), "both hook processes share the QODER_PID session key");
    assert(session.host === "qoder", "subagentStop records host=qoder");
    assert(session.currentPhase === "implement", "planner stop advances plan -> implement");
    assert(stopOut.includes('"tool":"Agent"') && stopOut.includes('"subagent_type":"orchestra-implementer"'),
      "spawn emits Qoder Agent + subagent_type");
    passed += 5;
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch (e) {
    console.log(`  ✗ Qoder hook surface: ${e.message}`);
    failed++;
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
