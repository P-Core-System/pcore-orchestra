#!/usr/bin/env node
"use strict";

/**
 * Self-check: bundle/hooks/lib/safe-write.js
 *
 * Covers:
 *  1. atomic write leaves no .tmp residue (success + retry paths)
 *  2. corrupt-file quarantine -> `.corrupt-<ts>` sibling + defaults (never silent reset)
 *  3. mutual-exclusion lock (cross-process) with stale takeover (~5s)
 *  4. backoff uses sync sleep — no pending timers keeping the process alive
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "safe-write-"));
const LIB = path.join(__dirname, "..", "bundle", "hooks", "lib", "safe-write.js");

let failed = 0;
let passed = 0;

function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function tmpResidue(dir) {
  return fs.readdirSync(dir).filter((f) => f.includes(".tmp."));
}

async function main() {
  // --- module load ---
  let sw = null;
  let loadErr = null;
  try {
    sw = require(LIB);
  } catch (e) {
    loadErr = e;
  }
  check("safe-write module loads", !!sw, loadErr && loadErr.message);
  if (!sw) {
    finish();
    return;
  }

  const api = ["atomicWrite", "writeJson", "readJsonSafe", "withLock", "tryAcquireLock", "releaseLock", "sleepSync", "lockPathFor"];
  for (const fn of api) {
    check(`exports ${fn}()`, typeof sw[fn] === "function");
  }

  // --- 1. atomic write leaves no .tmp residue ---
  const dir1 = path.join(tmp, "atomic");
  fs.mkdirSync(dir1, { recursive: true });
  const target1 = path.join(dir1, "state.json");
  sw.writeJson(target1, { hello: "world" });
  check("atomic write persists content", fs.existsSync(target1) && JSON.parse(fs.readFileSync(target1, "utf8")).hello === "world");
  check("atomic write leaves no .tmp residue", tmpResidue(dir1).length === 0, JSON.stringify(tmpResidue(dir1)));

  // retry path: first writeFileSync throws, second succeeds
  const dir2 = path.join(tmp, "retry");
  fs.mkdirSync(dir2, { recursive: true });
  const target2 = path.join(dir2, "state.json");
  const origWrite = fs.writeFileSync;
  let calls = 0;
  fs.writeFileSync = function (p, ...rest) {
    calls += 1;
    if (calls === 1) throw new Error("simulated EPERM");
    return origWrite.call(fs, p, ...rest);
  };
  let retryErr = null;
  try {
    sw.atomicWrite(target2, "payload");
  } catch (e) {
    retryErr = e;
  } finally {
    fs.writeFileSync = origWrite;
  }
  check("atomic write retries after transient failure", !retryErr && calls >= 2 && fs.readFileSync(target2, "utf8") === "payload", retryErr && retryErr.message);
  check("retry path leaves no .tmp residue", tmpResidue(dir2).length === 0, JSON.stringify(tmpResidue(dir2)));

  // --- 2. corrupt file quarantine ---
  const dir3 = path.join(tmp, "quarantine");
  fs.mkdirSync(dir3, { recursive: true });
  const target3 = path.join(dir3, "corrupt.json");
  const corruptBytes = "{ this is not json ";
  fs.writeFileSync(target3, corruptBytes);
  const defaults = { version: 3, sessions: {}, nested: { keep: true } };
  const loaded = sw.readJsonSafe(target3, defaults);
  check("corrupt file returns defaults", JSON.stringify(loaded) === JSON.stringify(defaults), JSON.stringify(loaded));
  const siblings = fs.readdirSync(dir3).filter((f) => /\.corrupt-\d+$/.test(f));
  check("corrupt file quarantined to .corrupt-<ts> sibling", siblings.length === 1, JSON.stringify(fs.readdirSync(dir3)));
  check(
    "quarantine preserves original bytes (never silent reset)",
    siblings.length === 1 && fs.readFileSync(path.join(dir3, siblings[0]), "utf8") === corruptBytes
  );
  check("corrupt original removed after quarantine", !fs.existsSync(target3));
  defaults.mutated = true;
  const loaded2 = sw.readJsonSafe(target3, { version: 3, sessions: {} });
  check("defaults are cloned (caller mutation does not leak)", loaded2.mutated === undefined && loaded2.version === 3);

  // valid JSON round-trip + missing file -> defaults (no quarantine)
  const dir4 = path.join(tmp, "roundtrip");
  fs.mkdirSync(dir4, { recursive: true });
  const target4 = path.join(dir4, "ok.json");
  sw.writeJson(target4, { a: 1 });
  check("readJsonSafe parses valid json", sw.readJsonSafe(target4, {}).a === 1);
  const missing = path.join(dir4, "nope.json");
  check("missing file returns defaults without quarantine", JSON.stringify(sw.readJsonSafe(missing, { z: 9 })) === JSON.stringify({ z: 9 }) && fs.readdirSync(dir4).filter((f) => f.includes(".corrupt-")).length === 0);

  // --- 3. lock: basic acquire/release + released on throw ---
  const dir5 = path.join(tmp, "lock");
  fs.mkdirSync(dir5, { recursive: true });
  const target5 = path.join(dir5, "counter.json");
  const lockPath = sw.lockPathFor(target5);
  check("lockPathFor appends .lock", lockPath === `${target5}.lock`, lockPath);

  let sawLock = false;
  sw.withLock(target5, () => {
    sawLock = fs.existsSync(lockPath);
  });
  check("withLock holds lock while fn runs", sawLock);
  check("withLock releases lock after fn", !fs.existsSync(lockPath));

  let threwLock = false;
  try {
    sw.withLock(target5, () => {
      throw new Error("boom");
    });
  } catch {
    threwLock = true;
  }
  check("withLock releases lock when fn throws", threwLock && !fs.existsSync(lockPath));

  check("tryAcquireLock fails while lock held", (() => {
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: Date.now() }));
    const ok = sw.tryAcquireLock(lockPath);
    fs.rmSync(lockPath, { force: true });
    return ok === false;
  })());

  // --- 3b. cross-process mutual exclusion ---
  const childScript = path.join(tmp, "child.js");
  fs.writeFileSync(
    childScript,
    [
      `"use strict";`,
      `const fs = require("node:fs");`,
      `const sw = require(${JSON.stringify(LIB)});`,
      `const target = process.argv[2];`,
      `const flag = process.argv[3];`,
      `sw.withLock(target, () => {`,
      `  fs.writeFileSync(flag, String(process.pid));`,
      `  sw.sleepSync(900);`,
      `  fs.rmSync(flag, { force: true });`,
      `});`,
      ``,
    ].join("\n")
  );
  const flagPath = path.join(dir5, "held.flag");
  const child = spawn(process.execPath, [childScript, target5, flagPath], { stdio: "ignore" });
  const childDone = new Promise((r) => child.on("exit", (code) => r(code)));

  // Wait until the child demonstrably holds the lock (flag written inside fn).
  let sawFlag = false;
  for (let i = 0; i < 300 && !sawFlag; i += 1) {
    sawFlag = fs.existsSync(flagPath);
    if (!sawFlag) await sleep(10);
  }
  check("child process entered the critical section", sawFlag);

  // tryAcquire must fail while a live holder has the lock. Guard against the
  // benign check-vs-acquire race: only a violation counts when the child's
  // flag is still present AFTER we (wrongly) acquired.
  let violated = false;
  if (sawFlag && !sw.tryAcquireLock(lockPath)) {
    violated = false;
  } else if (sawFlag) {
    violated = fs.existsSync(flagPath);
    sw.releaseLock(lockPath);
  }
  check("mutual exclusion: lock never acquired while another process held it", !violated);

  // Deterministic proof: our withLock blocks until the child leaves its
  // critical section, so by the time our fn runs the child's flag is gone.
  let flagPresentInsideParent = null;
  sw.withLock(target5, () => {
    flagPresentInsideParent = fs.existsSync(flagPath);
  });
  check(
    "withLock waits for the other process (flag gone inside our critical section)",
    flagPresentInsideParent === false,
    String(flagPresentInsideParent)
  );

  const childCode = await childDone;
  check("child exited cleanly", childCode === 0, `exit=${childCode}`);
  check("lock released by child", !fs.existsSync(lockPath));
  const freeAcquire = sw.tryAcquireLock(lockPath);
  check("tryAcquireLock succeeds when free", freeAcquire === true);
  sw.releaseLock(lockPath);

  // --- 3c. stale takeover (~5s) ---
  const target6 = path.join(dir5, "stale.json");
  const lock6 = sw.lockPathFor(target6);
  fs.writeFileSync(lock6, JSON.stringify({ pid: 4242, at: Date.now() }));
  const staleMs = (sw.LOCK_STALE_MS || 0);
  check("LOCK_STALE_MS is ~5s", staleMs >= 3000 && staleMs <= 8000, String(staleMs));
  // fresh lock must NOT be taken over
  check("fresh lock is not taken over", sw.tryAcquireLock(lock6) === false);
  // age the lock past the stale threshold
  const old = new Date(Date.now() - staleMs - 1500);
  fs.utimesSync(lock6, old, old);
  const t0 = Date.now();
  let staleTaken = false;
  try {
    sw.withLock(target6, () => {
      staleTaken = fs.existsSync(lock6);
    });
  } catch (e) {
    check("stale takeover does not throw", false, e.message);
  }
  const elapsed = Date.now() - t0;
  check("stale lock taken over", staleTaken);
  check("stale takeover returns promptly (<1500ms)", elapsed < 1500, `${elapsed}ms`);
  check("lock clean after stale takeover", !fs.existsSync(lock6));

  // --- 4. backoff uses sync sleep (no pending timers) ---
  const before = process.getActiveResourcesInfo().filter((r) => r === "Timeout" || r === "Immediate");
  sw.sleepSync(25);
  const after = process.getActiveResourcesInfo().filter((r) => r === "Timeout" || r === "Immediate");
  check("sleepSync leaves no pending timers", after.length === before.length, JSON.stringify(after));

  // exercise the real backoff branch inside atomicWrite
  const dir7 = path.join(tmp, "backoff");
  fs.mkdirSync(dir7, { recursive: true });
  const target7 = path.join(dir7, "b.json");
  const origWrite7 = fs.writeFileSync;
  let n7 = 0;
  fs.writeFileSync = function (p, ...rest) {
    n7 += 1;
    if (n7 === 1) throw new Error("simulated EACCES");
    return origWrite7.call(fs, p, ...rest);
  };
  try {
    sw.atomicWrite(target7, "retry-me");
  } finally {
    fs.writeFileSync = origWrite7;
  }
  const timersAfterBackoff = process.getActiveResourcesInfo().filter((r) => r === "Timeout" || r === "Immediate");
  check("atomicWrite backoff uses sync sleep (no timers)", timersAfterBackoff.length === before.length, JSON.stringify(timersAfterBackoff));
  check("backoff write succeeded", fs.readFileSync(target7, "utf8") === "retry-me");

  finish();
}

function finish() {
  console.log(`\n${failed ? "FAIL" : "PASS"} (${passed} passed, ${failed} failed)`);
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL", e);
  finish();
});
