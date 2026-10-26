#!/usr/bin/env node
"use strict";

/**
 * Merge orchestra hooks into a Claude Code settings.json.
 *
 * Claude Code accepts the same nested hook schema as Qoder (PascalCase events,
 * `{matcher, hooks:[{type,command,timeout}]}`), so the conversion helpers are
 * shared with scripts/merge-qoder-settings.js. All other settings keys
 * (permissions, model, env, mcpServers, ...) are preserved untouched.
 * Idempotent: hook entries are deduped by command string.
 *
 * Usage:
 *   node scripts/merge-claude-settings.js [--claude-home DIR] [--dry-run]
 *
 * Env: CLAUDE_CONFIG_DIR overrides the default ~/.claude.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { buildHooks, dedupeGroups } = require("./merge-qoder-settings.js");

const ROOT = path.join(__dirname, "..");

function parseArgs(argv) {
  const opts = {
    claudeHome: process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--claude-home" && argv[i + 1]) {
      opts.claudeHome = argv[++i];
    } else if (argv[i] === "--dry-run") {
      opts.dryRun = true;
    } else if (argv[i] === "-h" || argv[i] === "--help") {
      console.log("Usage: node scripts/merge-claude-settings.js [--claude-home DIR] [--dry-run]");
      process.exit(0);
    } else {
      console.error(`Unknown option: ${argv[i]}`);
      process.exit(1);
    }
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const srcPath = path.join(ROOT, "bundle", "hooks.json");
  const destPath = path.join(opts.claudeHome, "settings.json");

  const source = JSON.parse(fs.readFileSync(srcPath, "utf8"));
  const converted = buildHooks(source, opts.claudeHome);

  let dest = {};
  if (fs.existsSync(destPath)) {
    try {
      dest = JSON.parse(fs.readFileSync(destPath, "utf8"));
    } catch {
      dest = {};
    }
  }
  dest.hooks = dest.hooks || {};
  for (const [event, groups] of Object.entries(converted)) {
    dest.hooks[event] = dedupeGroups(dest.hooks[event], groups);
  }

  const serialized = JSON.stringify(dest, null, 2) + "\n";
  const before = fs.existsSync(destPath) ? fs.readFileSync(destPath, "utf8") : null;

  if (opts.dryRun) {
    console.log(`DRY RUN: would merge ${Object.keys(converted).join(", ")} hooks into ${destPath}`);
    return;
  }
  if (before === serialized) {
    console.log(`  Claude settings unchanged: ${destPath}`);
    return;
  }
  if (before !== null) {
    const backup = `${destPath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    fs.writeFileSync(backup, before);
    console.log(`  Backup: ${backup}`);
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tmp = `${destPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, serialized);
  fs.renameSync(tmp, destPath);
  console.log(`  Merged Claude hooks -> ${destPath} (${Object.keys(converted).join(", ")})`);
}

if (require.main === module) main();

module.exports = { parseArgs };
