#!/usr/bin/env node
"use strict";
/** Bridge: run a global ~/.cursor/hooks script from a project .cursor/hooks.json */
const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const scriptName = process.argv[2];
if (!scriptName) {
  process.stdout.write("{}");
  process.exit(0);
}

const home = process.env.USERPROFILE || process.env.HOME || "";
const target = path.join(home, ".cursor", "hooks", scriptName);

if (!fs.existsSync(target)) {
  process.stdout.write("{}");
  process.exit(0);
}

let data = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => {
  data += c;
});
process.stdin.on("end", () => {
  const r = cp.spawnSync(process.execPath, [target], {
    input: data,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (r.stdout) process.stdout.write(r.stdout);
  else process.stdout.write("{}");
});
