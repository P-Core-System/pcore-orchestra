#!/usr/bin/env node
"use strict";

/**
 * Step 6 self-check: bundle/hooks <-> bundle/opencode/hooks mirror sync.
 *
 * The two hook trees must stay byte-identical so a fix in one platform lands
 * in the other. Two entry scripts are deliberately platform-specific and are
 * the ONLY allowed differences:
 *   orchestra-health.js   (Cursor health command paths)
 *   orchestra-prompt.js   (Cursor prompt hook)
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const BASE = path.join(ROOT, "bundle", "hooks");
const MIRROR = path.join(ROOT, "bundle", "opencode", "hooks");

/** Entry scripts allowed to differ; matched by file name anywhere in the tree. */
const ALLOWED_DIFFS = ["orchestra-health.js", "orchestra-prompt.js"];

/** OpenCode-only entries (no Cursor counterpart); matched by file name. */
const ALLOWED_MIRROR_ONLY = ["orchestra-health-opencode.js"];

let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function listJs(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".js")) out.push(path.relative(dir, p).split(path.sep).join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

function bytesEqual(a, b) {
  const ba = fs.readFileSync(a);
  const bb = fs.readFileSync(b);
  if (ba.length !== bb.length) return false;
  for (let i = 0; i < ba.length; i++) if (ba[i] !== bb[i]) return false;
  return true;
}

/** @returns {{identical:string[], differing:string[], baseOnly:string[], mirrorOnly:string[]}} */
function compare(baseDir, mirrorDir, allowed) {
  const baseList = listJs(baseDir);
  const mirrorList = listJs(mirrorDir);
  const mirrorSet = new Set(mirrorList);
  const baseSet = new Set(baseList);

  const identical = [];
  const differing = [];
  for (const rel of baseList) {
    if (!mirrorSet.has(rel)) continue;
    if (bytesEqual(path.join(baseDir, rel), path.join(mirrorDir, rel))) identical.push(rel);
    else differing.push(rel);
  }

  return {
    identical,
    differing,
    baseOnly: baseList.filter((rel) => !mirrorSet.has(rel)),
    mirrorOnly: mirrorList.filter((rel) => !baseSet.has(rel)),
    allowed: allowed,
  };
}

function isAllowed(rel, allowed) {
  return allowed.includes(path.basename(rel));
}

// ------------------------------------------------------------- real trees
check("cursor hook tree exists", fs.existsSync(BASE), BASE);
check("opencode hook tree exists", fs.existsSync(MIRROR), MIRROR);

const res = compare(BASE, MIRROR, ALLOWED_DIFFS);

check("no cursor-only hook files", res.baseOnly.length === 0, res.baseOnly.join(", "));
const unexpectedMirrorOnly = res.mirrorOnly.filter((rel) => !ALLOWED_MIRROR_ONLY.includes(path.basename(rel)));
check(
  "mirror-only files are the documented OpenCode entries",
  unexpectedMirrorOnly.length === 0,
  unexpectedMirrorOnly.join(", ")
);
check(`hook files compared (${res.identical.length + res.differing.length})`, res.identical.length + res.differing.length >= 45, String(res.identical.length + res.differing.length));

const unexpected = res.differing.filter((rel) => !isAllowed(rel, ALLOWED_DIFFS));
check(
  "every differing file is an allowed platform exception",
  unexpected.length === 0,
  unexpected.join(", ")
);
check(
  "allowed exceptions are entry scripts (not lib)",
  res.differing.every((rel) => !rel.startsWith("lib/")),
  res.differing.join(", ")
);
check(
  "all lib files are byte-identical",
  res.differing.every((rel) => !rel.startsWith("lib/")) && res.identical.some((rel) => rel.startsWith("lib/")),
  `${res.identical.filter((r) => r.startsWith("lib/")).length} identical lib files`
);

// --------------------------------------------------- detection must work
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orchestra-mirror-"));
const a = path.join(tmp, "a");
const b = path.join(tmp, "b");
fs.mkdirSync(path.join(a, "lib"), { recursive: true });
fs.mkdirSync(path.join(b, "lib"), { recursive: true });
fs.writeFileSync(path.join(a, "lib", "same.js"), "module.exports = 1;\n");
fs.writeFileSync(path.join(b, "lib", "same.js"), "module.exports = 1;\n");
fs.writeFileSync(path.join(a, "lib", "drift.js"), "module.exports = 'cursor';\n");
fs.writeFileSync(path.join(b, "lib", "drift.js"), "module.exports = 'opencode';\n");
fs.writeFileSync(path.join(a, "orchestra-prompt.js"), "cursor\n");
fs.writeFileSync(path.join(b, "orchestra-prompt.js"), "opencode\n");
fs.writeFileSync(path.join(a, "only-base.js"), "x\n");

const fixture = compare(a, b, ALLOWED_DIFFS);
check("fixture detects a drifted lib file", fixture.differing.includes("lib/drift.js"), JSON.stringify(fixture.differing));
check("fixture treats orchestra-prompt.js as allowed", fixture.differing.includes("orchestra-prompt.js") && isAllowed("orchestra-prompt.js", ALLOWED_DIFFS));
check("fixture reports base-only files", fixture.baseOnly.length === 1 && fixture.baseOnly[0] === "only-base.js", JSON.stringify(fixture.baseOnly));
check(
  "allowed rule does not shield lib drift",
  fixture.differing.filter((rel) => !isAllowed(rel, ALLOWED_DIFFS)).length === 1,
  JSON.stringify(fixture.differing)
);

fs.rmSync(tmp, { recursive: true, force: true });

console.log(failed === 0 ? "\nAll mirror sync tests passed." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
