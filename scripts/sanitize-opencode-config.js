#!/usr/bin/env node
/**
 * sanitize-opencode-config.js — remove opencode.json keys that crash the sidecar.
 *
 * Usage:
 *   node scripts/sanitize-opencode-config.js [--heal] [--opencode-home PATH]
 *
 * Without --heal: report unsupported keys and exit 1 if any are present.
 * With --heal: backup, strip keys, rewrite opencode.json.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { sanitizeOpenCodeConfig, getOpenCodeVersion, MIN_TOOL_OUTPUT_VERSION } = require("./lib/opencode-config-sanitize.js");

const HOME = process.env.HOME || process.env.USERPROFILE || os.homedir();

function parseArgs(argv) {
  const out = {
    heal: false,
    opencodeHome:
      process.env.OPENCODE_CONFIG_DIR || path.join(HOME, ".config", "opencode"),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--heal") out.heal = true;
    else if (a === "--opencode-home") out.opencodeHome = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: node scripts/sanitize-opencode-config.js [--heal] [--opencode-home PATH]`);
      process.exit(0);
    }
  }
  return out;
}

function backup(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = `${file}.bak.${stamp}`;
  fs.copyFileSync(file, dest);
  return dest;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const configPath = path.join(opts.opencodeHome, "opencode.json");

  if (!fs.existsSync(configPath)) {
    console.log("No opencode.json at", configPath);
    process.exit(0);
  }

  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const { config, removed, fixed, version } = sanitizeOpenCodeConfig(raw);

  if (removed.length === 0 && fixed.length === 0) {
    console.log("OK   opencode.json has no unsupported keys (OpenCode", version || "unknown", ")");
    process.exit(0);
  }

  if (removed.length > 0) {
    console.log("WARN unsupported keys:", removed.join(", "));
    console.log("     OpenCode", version || getOpenCodeVersion() || "unknown",
      "— need >=" + MIN_TOOL_OUTPUT_VERSION + " for tool_output.");
  }
  if (fixed.length > 0) {
    console.log("WARN invalid fields (will normalize):", fixed.join(", "));
  }

  if (!opts.heal) {
    console.log("Run with --heal to strip them.");
    process.exit(1);
  }

  const bak = backup(configPath);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  console.log("HEALED stripped keys; backup ->", bak);
}

main();
