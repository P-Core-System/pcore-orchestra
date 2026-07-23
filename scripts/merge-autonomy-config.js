#!/usr/bin/env node
/**
 * merge-autonomy-config.js — apply orchestra autonomy defaults during install.
 *
 * Usage:
 *   node scripts/merge-autonomy-config.js --cursor [--cursor-home PATH]
 *   node scripts/merge-autonomy-config.js --opencode [--opencode-home PATH]
 *   node scripts/merge-autonomy-config.js --all
 *
 * Preserves: Cursor auth/model caches; OpenCode mcp.* secrets.
 * Writes: permissions.json, sandbox.json; merges cli-config + opencode.json.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.resolve(__dirname, "..");
const CONFIG = path.join(ROOT, "bundle", "config");
const HOME = process.env.HOME || process.env.USERPROFILE || os.homedir();

function expandHome(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/\$HOME/g, HOME)
    .replace(/^~\//, HOME + path.sep)
    .replace(/^~(?=[\\/]|$)/, HOME);
}

function expandDeep(value) {
  if (Array.isArray(value)) return value.map(expandDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = expandDeep(v);
    return out;
  }
  return expandHome(value);
}

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function uniq(arr) {
  return [...new Set((arr || []).filter((x) => typeof x === "string"))];
}

function backup(file) {
  if (!fs.existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = `${file}.bak.${stamp}`;
  fs.copyFileSync(file, dest);
  return dest;
}

function mergeCliAutonomy(cursorHome) {
  const patch = readJson(path.join(CONFIG, "cursor", "cli-autonomy.json"));
  if (!patch) throw new Error("missing bundle/config/cursor/cli-autonomy.json");
  const destPath = path.join(cursorHome, "cli-config.json");
  const dest = readJson(destPath, { version: 1, permissions: { allow: [], deny: [] } });
  backup(destPath);

  dest.permissions = dest.permissions || { allow: [], deny: [] };
  dest.permissions.allow = uniq([
    ...(dest.permissions.allow || []),
    ...(patch.permissions?.allow || []),
  ]);
  if (Array.isArray(patch.permissions?.deny)) {
    dest.permissions.deny = uniq([
      ...(dest.permissions.deny || []),
      ...patch.permissions.deny,
    ]);
  }

  dest.approvalMode = patch.approvalMode || dest.approvalMode || "unrestricted";
  dest.autoAcceptWebSearch =
    patch.autoAcceptWebSearch !== undefined
      ? patch.autoAcceptWebSearch
      : dest.autoAcceptWebSearch;
  dest.webFetchDomainAllowlist = uniq([
    ...(dest.webFetchDomainAllowlist || []),
    ...(patch.webFetchDomainAllowlist || []),
  ]);
  if (patch.sandbox) {
    dest.sandbox = { ...(dest.sandbox || {}), ...patch.sandbox };
  }

  writeJson(destPath, dest);
  console.log("  Merged Cursor CLI autonomy ->", destPath);
}

function writeCursorPermissions(cursorHome) {
  const src = readJson(path.join(CONFIG, "cursor", "permissions.json"));
  if (!src) throw new Error("missing bundle/config/cursor/permissions.json");
  const destPath = path.join(cursorHome, "permissions.json");
  backup(destPath);
  const existing = readJson(destPath, {});
  const merged = {
    terminalAllowlist: uniq([
      ...(existing.terminalAllowlist || []),
      ...(src.terminalAllowlist || []),
    ]),
    mcpAllowlist: uniq([...(existing.mcpAllowlist || []), ...(src.mcpAllowlist || [])]),
    autoRun: {
      allow_instructions: uniq([
        ...(existing.autoRun?.allow_instructions || []),
        ...(src.autoRun?.allow_instructions || []),
      ]),
      block_instructions: uniq([
        ...(existing.autoRun?.block_instructions || []),
        ...(src.autoRun?.block_instructions || []),
      ]),
    },
  };
  writeJson(destPath, merged);
  console.log("  Updated Cursor permissions.json ->", destPath);
}

function writeCursorSandbox(cursorHome) {
  const src = expandDeep(readJson(path.join(CONFIG, "cursor", "sandbox.json")));
  if (!src) throw new Error("missing bundle/config/cursor/sandbox.json");
  const destPath = path.join(cursorHome, "sandbox.json");
  backup(destPath);
  const existing = expandDeep(readJson(destPath, {})) || {};
  const merged = {
    type: src.type || existing.type || "workspace_readwrite",
    enableSharedBuildCache:
      src.enableSharedBuildCache ?? existing.enableSharedBuildCache ?? true,
    additionalReadwritePaths: uniq([
      ...(existing.additionalReadwritePaths || []),
      ...(src.additionalReadwritePaths || []),
    ]),
    additionalReadonlyPaths: uniq([
      ...(existing.additionalReadonlyPaths || []),
      ...(src.additionalReadonlyPaths || []),
    ]),
    networkPolicy: {
      ...(existing.networkPolicy || {}),
      ...(src.networkPolicy || {}),
      allow: uniq([
        ...(existing.networkPolicy?.allow || []),
        ...(src.networkPolicy?.allow || []),
      ]),
      deny: uniq([
        ...(existing.networkPolicy?.deny || []),
        ...(src.networkPolicy?.deny || []),
      ]),
    },
  };
  writeJson(destPath, merged);
  console.log("  Updated Cursor sandbox.json ->", destPath);
}

function mergeOpenCodeAutonomy(opencodeHome) {
  const patch = readJson(path.join(CONFIG, "opencode", "autonomy.json"));
  if (!patch) throw new Error("missing bundle/config/opencode/autonomy.json");
  const destPath = path.join(opencodeHome, "opencode.json");
  const dest = readJson(destPath, { $schema: "https://opencode.ai/config.json" });
  backup(destPath);

  // Preserve MCP / secrets entirely
  const mcp = dest.mcp;

  if (!dest.model && patch.model) dest.model = patch.model;
  if (!dest.small_model && patch.small_model) dest.small_model = patch.small_model;
  dest.compaction = { ...(dest.compaction || {}), ...(patch.compaction || {}) };
  if (patch.watcher) dest.watcher = { ...(dest.watcher || {}), ...patch.watcher };
  if (patch.snapshot !== undefined) dest.snapshot = patch.snapshot;
  dest.permission = { ...(dest.permission || {}), ...(patch.permission || {}) };
  dest.agent = { ...(dest.agent || {}), ...(patch.agent || {}) };
  if (patch.provider) {
    dest.provider = dest.provider || {};
    for (const [k, v] of Object.entries(patch.provider)) {
      dest.provider[k] = { ...(dest.provider[k] || {}), ...v };
    }
  }
  if (mcp) dest.mcp = mcp;

  writeJson(destPath, dest);
  console.log("  Merged OpenCode autonomy ->", destPath);
  console.log("  Tip: start OpenCode with --auto for session auto-approve");
}

function parseArgs(argv) {
  const out = {
    cursor: false,
    opencode: false,
    cursorHome: process.env.CURSOR_HOME || path.join(HOME, ".cursor"),
    opencodeHome:
      process.env.OPENCODE_CONFIG_DIR || path.join(HOME, ".config", "opencode"),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") {
      out.cursor = true;
      out.opencode = true;
    } else if (a === "--cursor") out.cursor = true;
    else if (a === "--opencode") out.opencode = true;
    else if (a === "--cursor-home") out.cursorHome = argv[++i];
    else if (a === "--opencode-home") out.opencodeHome = argv[++i];
  }
  if (!out.cursor && !out.opencode) {
    out.cursor = true;
    out.opencode = true;
  }
  return out;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log("==> Applying orchestra autonomy config");
  if (opts.cursor) {
    mergeCliAutonomy(opts.cursorHome);
    writeCursorPermissions(opts.cursorHome);
    writeCursorSandbox(opts.cursorHome);
    console.log(
      "  Manual: Cursor Settings → Agents → Approvals & Execution → Auto-review"
    );
  }
  if (opts.opencode) {
    fs.mkdirSync(opts.opencodeHome, { recursive: true });
    mergeOpenCodeAutonomy(opts.opencodeHome);
  }
  console.log("==> Autonomy config done");
}

main();
