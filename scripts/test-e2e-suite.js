#!/usr/bin/env node
"use strict";

/**
 * End-to-end suite runner — executes every scripts/test-*.js sequentially in
 * a child process (full isolation, real exit codes), then prints a summary.
 *
 * Usage:
 *   node scripts/test-e2e-suite.js            # run all
 *   node scripts/test-e2e-suite.js --only NAME[,NAME]  # subset (file stems)
 *   SUITE_TIMEOUT_MS=300000 node scripts/test-e2e-suite.js
 *
 * Exit 0 only when every suite passes.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SCRIPTS = path.join(__dirname);
const ROOT = path.resolve(__dirname, "..");
const TIMEOUT_MS = parseInt(process.env.SUITE_TIMEOUT_MS || "240000", 10);

const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx !== -1 ? new Set(process.argv[onlyIdx + 1].split(",")) : null;

const suites = fs
  .readdirSync(SCRIPTS)
  .filter((f) => /^test-.*\.js$/.test(f))
  .filter((f) => f !== "test-e2e-suite.js") // never recurse into the runner itself
  .sort()
  .filter((f) => (only ? only.has(f.replace(/^test-|\.js$/g, "")) : true));

if (!suites.length) {
  console.error("no suites matched");
  process.exit(2);
}

const results = [];
for (const file of suites) {
  const started = Date.now();
  process.stdout.write(`▶ ${file} ... `);
  let r, ms = 0, attempts = 0;
  do {
    attempts++;
    const t0 = Date.now();
    r = spawnSync(process.execPath, [path.join(SCRIPTS, file)], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
    });
    ms = Date.now() - t0;
  } while (r.status !== 0 && attempts < 2 && process.env.SUITE_RETRY !== "0");
  const ok = r.status === 0;
  if (attempts > 1 && ok) process.stdout.write(`ok-after-retry `);
  console.log(ok ? `ok (${ms}ms)` : `FAILED (exit=${r.status ?? "signal"} ${ms}ms)`);
  if (!ok) {
    const out = (r.stdout || "") + (r.stderr || "");
    const tail = out.trim().split("\n").filter((l) => /FAIL|Error|error:/i.test(l)).slice(0, 8);
    (tail.length ? tail : out.trim().split("\n").slice(-8)).forEach((l) => console.log("    " + l));
  }
  results.push({ file, ok, ms });
}

const failed = results.filter((r) => !r.ok);
console.log("\n================ E2E SUITE SUMMARY ================");
console.log(`${results.length - failed.length}/${results.length} suites passed · total ${results.reduce((a, r) => a + r.ms, 0)}ms`);
failed.forEach((f) => console.log(`  FAILED: ${f.file}`));
console.log(failed.length ? "VERDICT: FAIL" : "VERDICT: PASS");
process.exit(failed.length ? 1 : 0);
