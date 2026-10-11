#!/usr/bin/env node
/**
 * migrate-opencode-v2.js — migrate an opencode.json file from V1 to native V2.
 *
 * Usage:
 *   node scripts/migrate-opencode-v2.js                  # dry-run (default)
 *   node scripts/migrate-opencode-v2.js --apply          # write + timestamped backup
 *   node scripts/migrate-opencode-v2.js --file PATH      # migrate a specific file
 *   node scripts/migrate-opencode-v2.js --opencode-home DIR
 *
 * Default target: $OPENCODE_CONFIG_DIR/opencode.json, else
 * ~/.config/opencode/opencode.json.
 *
 * The transformation is behavior-preserving: `opencode debug config` on the
 * migrated file normalizes identically to the original (enforced by
 * scripts/test-opencode-v2.js oracle round-trips).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { migrateConfig } = require("./lib/opencode-v2.js");

const V1_KEYS = [
  "permission",
  "autoupdate",
  "snapshot",
  "agent",
  "small_model",
  "provider",
  "enabled_providers",
  "command",
  "hooks",
];

function parseArgs(argv) {
  const out = { apply: false, file: null, opencodeHome: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--file") out.file = argv[++i];
    else if (a === "--opencode-home") out.opencodeHome = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
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
  if (opts.help) {
    console.log(fs.readFileSync(__filename, "utf8").split("*/")[0].replace(/^\/\*\*?/, "").trim());
    process.exit(0);
  }

  const home =
    opts.opencodeHome ||
    process.env.OPENCODE_CONFIG_DIR ||
    path.join(os.homedir(), ".config", "opencode");
  const file = opts.file || path.join(home, "opencode.json");

  if (!fs.existsSync(file)) {
    console.error(`Not found: ${file}`);
    process.exit(1);
  }

  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`Invalid JSON in ${file}: ${err.message}`);
    process.exit(1);
  }

  const migrated = migrateConfig(cfg);
  const originalKeys = Object.keys(cfg);
  const migratedKeys = Object.keys(migrated);
  const removed = originalKeys.filter((k) => !migratedKeys.includes(k));
  const added = migratedKeys.filter((k) => !originalKeys.includes(k));
  const v1Present = originalKeys.filter((k) => V1_KEYS.includes(k));
  const changed = JSON.stringify(cfg) !== JSON.stringify(migrated);

  if (!changed) {
    console.log(`Already native V2 — nothing to migrate: ${file}`);
    process.exit(0);
  }

  console.log(`V1 → V2 migration for ${file}`);
  if (v1Present.length > 0) console.log(`  V1 keys found:      ${v1Present.join(", ")}`);
  if (removed.length > 0) console.log(`  mapped/removed:     ${removed.join(", ")}`);
  if (added.length > 0) console.log(`  produced:           ${added.join(", ")}`);

  if (!opts.apply) {
    console.log("\nDry run — no changes written. Re-run with --apply to write.");
    console.log("Verify afterwards with: opencode debug config");
    process.exit(0);
  }

  const bak = backup(file);
  fs.writeFileSync(file, JSON.stringify(migrated, null, 2) + "\n");
  console.log(`\nWrote V2 config:  ${file}`);
  console.log(`Backup:           ${bak}`);
  console.log("Verify with:      opencode debug config   (must match pre-migration output)");
  process.exit(0);
}

main();
