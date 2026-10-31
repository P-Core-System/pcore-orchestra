#!/usr/bin/env node
"use strict";

/**
 * Idempotently register the Orchestra MCP hub in an `mcpServers` config file —
 * the MCP project convention that Cursor (`~/.cursor/mcp.json`), Claude Code,
 * and Qoder (`.mcp.json`) all read. It only touches the `mcpServers` map and
 * preserves every other key already in the file, so it is safe to re-run.
 *
 * Default target is `<repo>/.mcp.json`; default transport is stdio against
 * scripts/mcp-knowledge-server.js, which serves docs, knowledge, chat threads,
 * and master prompts for `--root`. For a remote connector (ChatGPT/Gemini),
 * register the tunneled HTTP URL instead with `--url` (bearer token lives in
 * PCORE_MCP_TOKEN, never in the URL).
 *
 * Usage:
 *   node scripts/mcp-register.js [--target PATH] [--name orchestra]
 *       [--root PATH] [--url https://.../mcp] [--dry-run] [--print]
 */

const fs = require("node:fs");
const path = require("node:path");
const { readJsonSafe, writeJson } = require("../bundle/hooks/lib/safe-write.js");

const REPO = path.join(__dirname, "..");
const SERVER_JS = path.join(REPO, "scripts", "mcp-knowledge-server.js");
const DEFAULT_NAME = "orchestra";

function parseArgs(argv) {
  const out = { name: DEFAULT_NAME, root: process.cwd(), dryRun: false, print: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--target") out.target = argv[++i];
    else if (a === "--name") out.name = argv[++i];
    else if (a === "--root") out.root = path.resolve(argv[++i]);
    else if (a === "--url") out.url = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--print") out.print = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  out.target = out.target ? path.resolve(out.target) : path.join(REPO, ".mcp.json");
  return out;
}

function stdioEntry(root) {
  return {
    command: "node",
    args: [SERVER_JS, "--stdio", "--root", root],
    env: { PCORE_MCP_ROOT: root },
  };
}

function httpEntry(url) {
  // MCP remote shape; token comes from the environment, not the URL.
  return { type: "streamable-http", url };
}

function register(args) {
  const config = readJsonSafe(args.target, {}) || {};
  if (typeof config !== "object" || Array.isArray(config)) {
    throw new Error("target is not a JSON object: " + args.target);
  }
  if (!config.mcpServers || typeof config.mcpServers !== "object" || Array.isArray(config.mcpServers)) {
    config.mcpServers = {};
  }
  const entry = args.url ? httpEntry(args.url) : stdioEntry(args.root);
  const before = JSON.stringify(config.mcpServers[args.name]);
  config.mcpServers[args.name] = entry;
  const changed = before !== JSON.stringify(entry);
  return { config, entry, changed };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      [
        "Usage: node scripts/mcp-register.js [--target PATH] [--name orchestra] [--root PATH] [--url https://.../mcp] [--dry-run] [--print]",
        "",
        "  --target  mcpServers config file (default: <repo>/.mcp.json)",
        "  --name    server key under mcpServers (default: orchestra)",
        "  --root    project root the stdio server serves (default: cwd)",
        "  --url     register a remote/streamable-http URL instead of stdio",
        "  --dry-run do not write; --print emit the resulting JSON",
        "",
      ].join("\n")
    );
    return 0;
  }
  const { config, entry, changed } = register(args);
  const summary = {
    target: args.target,
    name: args.name,
    transport: args.url ? "streamable-http" : "stdio",
    changed,
    entry,
  };
  if (!args.dryRun) writeJson(args.target, config);
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  if (args.print) process.stdout.write("\n" + JSON.stringify(config, null, 2) + "\n");
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
} else {
  module.exports = { register, stdioEntry, httpEntry, SERVER_JS, DEFAULT_NAME };
}
