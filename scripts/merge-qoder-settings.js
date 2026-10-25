#!/usr/bin/env node
"use strict";

/**
 * Merge orchestra hooks into a Qoder CLI settings.json.
 *
 * Converts bundle/hooks.json (Cursor event names, relative commands) to the
 * Qoder hooks schema (PascalCase events, nested matcher/hooks arrays,
 * absolute commands anchored at the Qoder home). All other settings keys
 * (model, security, permissions, mcpServers, ...) are preserved untouched.
 * Idempotent: hook entries are deduped by command string.
 *
 * Usage:
 *   node scripts/merge-qoder-settings.js [--qoder-home DIR] [--dry-run]
 *
 * Env: QODER_CONFIG_DIR overrides the default ~/.qoder.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const ROOT = path.join(__dirname, "..");

// Cursor hooks.json event -> Qoder settings.json hooks event
const EVENT_MAP = {
  sessionStart: "SessionStart",
  beforeSubmitPrompt: "UserPromptSubmit",
  subagentStop: "SubagentStop",
  stop: "Stop",
};

function parseArgs(argv) {
  const opts = { qoderHome: process.env.QODER_CONFIG_DIR || path.join(os.homedir(), ".qoder"), dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--qoder-home" && argv[i + 1]) { opts.qoderHome = argv[++i]; }
    else if (argv[i] === "--dry-run") { opts.dryRun = true; }
    else if (argv[i] === "-h" || argv[i] === "--help") {
      console.log("Usage: node scripts/merge-qoder-settings.js [--qoder-home DIR] [--dry-run]");
      process.exit(0);
    } else {
      console.error(`Unknown option: ${argv[i]}`);
      process.exit(1);
    }
  }
  return opts;
}

/** `node ./hooks/x.js` -> `node <qoderHome>/hooks/x.js`; other commands pass through. */
function absolutizeCommand(command, qoderHome) {
  return command.replace(/(\.\/hooks\/)/g, `${qoderHome.replace(/\\/g, "/")}/hooks/`);
}

/** Convert one Cursor hooks.json event array to Qoder matcher-group entries. */
function convertEvent(entries, qoderHome) {
  return (entries || []).map((entry) => {
    const hook = { type: "command", command: absolutizeCommand(entry.command, qoderHome) };
    if (typeof entry.timeout === "number") hook.timeout = entry.timeout;
    const group = { hooks: [hook] };
    if (entry.matcher) group.matcher = entry.matcher;
    return group;
  });
}

function dedupeGroups(existing, incoming) {
  const seen = new Set();
  const out = [];
  for (const group of [...(existing || []), ...incoming]) {
    const key = JSON.stringify((group.hooks || []).map((h) => h.command).sort());
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(group);
  }
  return out;
}

function buildHooks(source, qoderHome) {
  const hooks = {};
  for (const [cursorEvent, entries] of Object.entries(source.hooks || {})) {
    const qoderEvent = EVENT_MAP[cursorEvent];
    if (!qoderEvent) continue; // unknown events are skipped, not failed
    hooks[qoderEvent] = convertEvent(entries, qoderHome);
  }
  return hooks;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const srcPath = path.join(ROOT, "bundle", "hooks.json");
  const destPath = path.join(opts.qoderHome, "settings.json");

  const source = JSON.parse(fs.readFileSync(srcPath, "utf8"));
  const converted = buildHooks(source, opts.qoderHome);

  let dest = {};
  if (fs.existsSync(destPath)) {
    try { dest = JSON.parse(fs.readFileSync(destPath, "utf8")); } catch { dest = {}; }
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
    console.log(`  Qoder settings unchanged: ${destPath}`);
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
  console.log(`  Merged Qoder hooks -> ${destPath} (${Object.keys(converted).join(", ")})`);
}

if (require.main === module) main();

module.exports = { buildHooks, convertEvent, dedupeGroups, absolutizeCommand, EVENT_MAP };
