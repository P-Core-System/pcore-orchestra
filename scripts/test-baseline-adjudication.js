#!/usr/bin/env node
"use strict";

/**
 * Self-check for baseline adjudication:
 *  1. recordBaseline writes a parseable file and returns path/count/at
 *  2. a failure that also failed in the baseline adjudicates as foreign
 *  3. a failure that passed (or is absent) in the baseline is new
 *  4. passing gates are never listed
 *  5. a missing/empty baseline makes every failure new
 *  6. adjudication never flips verdicts (classification only)
 *  7. no .tmp.* residue after ops
 *
 * Temp dirs only; the real home config is never touched.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const base = path.join(__dirname, "..", ".tmp-test-baseline-adjudication");
fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(base, { recursive: true });

const e = require("../bundle/hooks/lib/evidence-runner.js");

let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const f = path.join(dir, name);
    if (fs.lstatSync(f).isDirectory()) out.push(...walk(f));
    else out.push(f);
  }
  return out;
}

try {
  check("recordBaseline exported", typeof e.recordBaseline === "function");
  check("adjudicateVsBaseline exported", typeof e.adjudicateVsBaseline === "function");
  check("BASELINE_FILENAME exported", e.BASELINE_FILENAME === "baseline.json");

  const prior = [
    { gate: "tests", ok: false },
    { gate: "lint", ok: false },
    { gate: "build", ok: true },
  ];

  // ---- 1. record ----
  const rec = e.recordBaseline(prior, { dir: base });
  check("record returns path/count/at", !!rec.path && rec.count === 3 && !!rec.at,
    JSON.stringify({ path: !!rec.path, count: rec.count }));
  check("baseline file exists", fs.existsSync(rec.path));
  const stored = JSON.parse(fs.readFileSync(rec.path, "utf8"));
  check("baseline shape", stored.version === 1 && !!stored.at && !!stored.gates, JSON.stringify(Object.keys(stored)));
  check("baseline verdicts kept", stored.gates.tests.ok === false && stored.gates.build.ok === true);

  // ---- 2/3/4. adjudicate ----
  const current = [
    { gate: "tests", ok: false }, // failed before -> foreign
    { gate: "lint", ok: true }, // healed -> never listed
    { gate: "build", ok: false }, // passed before -> new
    { gate: "security", ok: false }, // absent before -> new
  ];
  const adj = e.adjudicateVsBaseline(current, stored);
  check("still-failing is foreign", JSON.stringify(adj.foreign) === JSON.stringify(["tests"]), JSON.stringify(adj));
  check("regressions + unknowns are new", JSON.stringify(adj.new) === JSON.stringify(["build", "security"]), JSON.stringify(adj));

  // ---- 5. missing/empty baseline ----
  const allNew = e.adjudicateVsBaseline(current, null);
  check("null baseline -> all new", allNew.foreign.length === 0 && allNew.new.length === 3, JSON.stringify(allNew));
  const emptyNew = e.adjudicateVsBaseline(current, { gates: {} });
  check("empty baseline -> all new", emptyNew.foreign.length === 0 && emptyNew.new.length === 3);
  const noFail = e.adjudicateVsBaseline([{ gate: "tests", ok: true }], stored);
  check("all-pass -> both empty", noFail.new.length === 0 && noFail.foreign.length === 0);

  // ---- 6. classification only ----
  check("verdicts untouched by adjudication",
    current[0].ok === false && current[1].ok === true && stored.gates.tests.ok === false);

  // ---- 7. no .tmp.* residue ----
  const residue = walk(base).filter((f) => path.basename(f).indexOf(".tmp.") !== -1);
  check("no .tmp.* residue", residue.length === 0, JSON.stringify(residue));
} finally {
  try {
    fs.rmSync(base, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

if (failed) {
  console.log(`\nFAIL (${failed} checks)`);
  process.exit(1);
}
console.log("\nPASS (all checks)");
