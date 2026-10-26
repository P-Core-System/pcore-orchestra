"use strict";

/**
 * Tests for scripts/sync-claude-agents.js and scripts/merge-claude-settings.js,
 * plus the Claude Code SubagentStop block contract.
 */

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const SYNC = path.join(ROOT, "scripts", "sync-claude-agents.js");
const MERGE = path.join(ROOT, "scripts", "merge-claude-settings.js");
const SRC = path.join(ROOT, "bundle", "agents");
const DEST = path.join(ROOT, "bundle", "claude", "agents");

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

function runMerge(args) {
  return execFileSync(process.execPath, [MERGE, ...args], { cwd: ROOT, encoding: "utf8" });
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
  console.log("=== test-claude-sync.js ===");
  let passed = 0;
  let failed = 0;
  const tmpDirs = [];

  // Test 1: sync runs and produces the conductor agent
  try {
    runSync();
    assert(fs.existsSync(path.join(DEST, "orchestra.md")), "bundle/claude/agents/orchestra.md exists after sync");
    passed++;
  } catch (e) {
    console.log(`  ✗ sync run: ${e.message}`);
    failed++;
  }

  // Test 2: readonly planner conversion
  try {
    const srcFm = parseFmFields(splitFrontmatter(fs.readFileSync(path.join(SRC, "orchestra-planner.md"), "utf8")).fm);
    const gen = splitFrontmatter(fs.readFileSync(path.join(DEST, "orchestra-planner.md"), "utf8"));
    assert(gen.fm !== null, "generated orchestra-planner.md has frontmatter");
    const genFm = parseFmFields(gen.fm);
    assert(genFm.name === "orchestra-planner", "generated planner has name: orchestra-planner");
    assert(typeof genFm.description === "string" && genFm.description.length > 0, "generated planner has description");
    assert(!/^readonly:/m.test(gen.fm), "generated planner drops readonly");
    assert(!/^steps:/m.test(gen.fm), "generated planner drops steps");
    assert(!/^model:/m.test(gen.fm), "generated planner does not emit model (inherits session)");
    assert(!/^maxTurns:/m.test(gen.fm), "generated planner does not emit maxTurns");
    assert(genFm.disallowedTools === "Write, Edit, NotebookEdit", "readonly planner gets disallowedTools");
    assert(genFm.tools === srcFm.tools, "source tools allowlist preserved");
    passed += 9;
  } catch (e) {
    console.log(`  ✗ planner conversion: ${e.message}`);
    failed++;
  }

  // Test 3: writable agent gets permissionMode, not disallowedTools
  try {
    const genFm = parseFmFields(splitFrontmatter(fs.readFileSync(path.join(DEST, "orchestra-implementer.md"), "utf8")).fm);
    assert(genFm.permissionMode === "acceptEdits", "writable implementer gets permissionMode: acceptEdits");
    assert(genFm.disallowedTools === undefined, "writable implementer has no disallowedTools");
    passed += 2;
  } catch (e) {
    console.log(`  ✗ writable conversion: ${e.message}`);
    failed++;
  }

  // Test 4: flat mirror and count parity with the source tree
  try {
    const srcCount = walk(SRC).filter((f) => !path.relative(SRC, f).startsWith("references" + path.sep)).length;
    const destFiles = walk(DEST);
    const nested = destFiles.filter((f) => path.dirname(f) !== DEST);
    assert(nested.length === 0, "mirror is flat (Claude Code agent discovery is name-based)");
    assert(destFiles.length === srcCount, `generated agent count (${destFiles.length}) == source agent count (${srcCount})`);
    const names = destFiles.map((f) => path.basename(f, ".md"));
    assert(new Set(names).size === names.length, "agent basenames are unique");
    passed += 3;
  } catch (e) {
    console.log(`  ✗ mirror shape: ${e.message}`);
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
    const tooLong = [];
    for (const file of walk(DEST)) {
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

  // Test 8: settings merge — events, absolutization, preservation, idempotency
  try {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "claude-merge-"));
    tmpDirs.push(home);
    runMerge(["--claude-home", home]);
    const s = JSON.parse(fs.readFileSync(path.join(home, "settings.json"), "utf8"));
    for (const event of ["SessionStart", "UserPromptSubmit", "SubagentStop", "Stop"]) {
      assert(Array.isArray(s.hooks[event]) && s.hooks[event].length > 0, `hooks.${event} present`);
    }
    const commands = Object.values(s.hooks).flat().flatMap((g) => g.hooks.map((h) => h.command));
    assert(commands.every((c) => c.includes(`${home}/hooks/`) && !c.includes("./hooks/")), "all commands absolute into the Claude home");

    const home2 = fs.mkdtempSync(path.join(os.tmpdir(), "claude-merge-"));
    tmpDirs.push(home2);
    fs.writeFileSync(
      path.join(home2, "settings.json"),
      JSON.stringify({ model: "opus", permissions: { allow: ["Bash(git status)"] }, env: { FOO: "bar" } }, null, 2)
    );
    runMerge(["--claude-home", home2]);
    const s2 = JSON.parse(fs.readFileSync(path.join(home2, "settings.json"), "utf8"));
    assert(s2.model === "opus" && s2.permissions.allow[0] === "Bash(git status)" && s2.env.FOO === "bar", "existing settings keys preserved");
    assert(fs.readdirSync(home2).some((f) => f.startsWith("settings.json.bak-")), "backup written for pre-existing settings");

    const before = fs.readFileSync(path.join(home2, "settings.json"), "utf8");
    const out = runMerge(["--claude-home", home2]);
    assert(fs.readFileSync(path.join(home2, "settings.json"), "utf8") === before, "settings unchanged on re-run");
    assert(out.includes("unchanged"), "reports unchanged");

    const home3 = fs.mkdtempSync(path.join(os.tmpdir(), "claude-merge-"));
    tmpDirs.push(home3);
    runMerge(["--claude-home", home3, "--dry-run"]);
    assert(!fs.existsSync(path.join(home3, "settings.json")), "dry-run creates no settings.json");
    passed += 10;
  } catch (e) {
    console.log(`  ✗ settings merge: ${e.message}`);
    failed++;
  }

  // Test 9: Claude session env is honored by the state manager
  try {
    const sm = require(path.join(ROOT, "bundle", "hooks", "lib", "state-manager.js"));
    const keys = ["PCORE_SESSION_ID", "OPENCODE_SESSION_ID", "CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID", "CURSOR_TRACE_ID", "QODER_SESSION_ID", "QODER_PID"];
    const saved = {};
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    try {
      process.env.CLAUDE_CODE_SESSION_ID = "claude-env-1";
      assert(sm.getSessionId() === "claude-env-1", "CLAUDE_CODE_SESSION_ID seeds the shared session");
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
    passed++;
  } catch (e) {
    console.log(`  ✗ Claude session env: ${e.message}`);
    failed++;
  }

  // Test 10: SubagentStop block path emits Claude's decision/reason, Cursor's followup
  try {
    const stateKeys = ["PCORE_STATE_DIR", "PCORE_SESSION_ID", "OPENCODE_SESSION_ID", "CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID", "CURSOR_TRACE_ID", "QODER_SESSION_ID", "QODER_PID", "QODER_CLI"];
    const saved = {};
    for (const k of stateKeys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    const runBlock = (sessionEnv, label) => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `claude-hook-${label}-`));
      tmpDirs.push(tmp);
      const ws = path.join(tmp, "ws");
      const stateDir = path.join(tmp, "state");
      fs.mkdirSync(ws, { recursive: true });
      const env = { ...process.env, PCORE_STATE_DIR: stateDir, ...sessionEnv };
      execFileSync(process.execPath, [path.join(ROOT, "bundle", "hooks", "orchestra-prompt.js")], {
        cwd: ws,
        input: JSON.stringify({ prompt: "fix login bug", cwd: ws }),
        env,
        encoding: "utf8",
        stdio: "pipe",
      });
      const out = execFileSync(process.execPath, [path.join(ROOT, "bundle", "hooks", "orchestra-subagent-stop.js")], {
        cwd: ws,
        input: JSON.stringify({ status: "completed", agent_type: "orchestra-planner", cwd: ws, summary: "plan without a token" }),
        env,
        encoding: "utf8",
        stdio: "pipe",
      });
      return JSON.parse(out.trim().split("\n").pop());
    };

    try {
      const claude = runBlock({ CLAUDE_CODE_SESSION_ID: "claude-block-1" }, "claude");
      assert(claude.decision === "block", "Claude block outcome emits decision:block");
      assert(typeof claude.reason === "string" && claude.reason.includes("missing its end token"), "Claude block carries the corrective reason");
      assert(claude.followup_message === undefined, "Claude block does not emit Cursor followup_message");

      const cursor = runBlock({ CURSOR_TRACE_ID: "cursor-block-1" }, "cursor");
      assert(typeof cursor.followup_message === "string" && cursor.followup_message.includes("missing its end token"), "Cursor block still emits followup_message");
      assert(cursor.decision === undefined, "Cursor block does not emit Claude decision");
    } finally {
      for (const k of stateKeys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
    passed += 5;
  } catch (e) {
    console.log(`  ✗ Claude block emit: ${e.message}`);
    failed++;
  }

  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
