#!/usr/bin/env node
"use strict";

/**
 * Tool-surface audit (workstream E — token/context, 2026-10-29).
 *
 * Every `tools:` allowlist line in agent frontmatter and every permission
 * action rule in docs/opencode.json.example is schema the model pays for on
 * every call — the "idle-tool tax": declared-but-never-invoked surface still
 * costs context (Zeng et al. 2026 idle-tool taxonomy — terminology reference,
 * docs/token-optimization.md §11.5/§11.7).
 *
 * Report-only by default (always exits 0). `--fail-over <n>` turns it into a
 * gate: exit 1 when any agent declares MORE than n tools.
 *
 * Usage:
 *   node scripts/audit-tool-surface.js
 *   node scripts/audit-tool-surface.js --fail-over 8
 */

const fs = require("node:fs");
const path = require("node:path");
const { splitFrontmatter, parseFmFields, walkMarkdown } = require("./lib/agent-frontmatter.js");

const ROOT = path.join(__dirname, "..");
const AGENT_ROOT = path.join(ROOT, "bundle", "agents");
const EXAMPLE_CONFIG = path.join(ROOT, "docs", "opencode.json.example");

function parseArgs(argv) {
  const args = { failOver: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--fail-over") {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v)) {
        console.error("--fail-over requires a number (e.g. --fail-over 8)");
        process.exit(2);
      }
      args.failOver = v;
    } else if (a.startsWith("--fail-over=")) {
      const v = Number(a.slice("--fail-over=".length));
      if (!Number.isFinite(v)) {
        console.error("--fail-over requires a number (e.g. --fail-over=8)");
        process.exit(2);
      }
      args.failOver = v;
    } else if (a === "--help" || a === "-h") {
      console.log("Usage: node scripts/audit-tool-surface.js [--fail-over <n>]");
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function splitTools(value) {
  if (value == null) return [];
  return String(value)
    .split(/[\s,|]+/)
    .map((t) => t.replace(/^["'[\]]|["'\]]$/g, ""))
    .filter(Boolean);
}

function auditAgents() {
  const files = walkMarkdown(AGENT_ROOT).sort();
  const rows = [];
  const missing = [];
  const toolCounts = {};
  let withTools = 0;
  let toolsDeclChars = 0;

  for (const file of files) {
    const rel = path.relative(AGENT_ROOT, file).replace(/\\/g, "/");
    const { fm } = splitFrontmatter(fs.readFileSync(file, "utf8"));
    const fields = fm ? parseFmFields(fm) : {};
    const tools = splitTools(fields.tools);
    if (fields.tools !== undefined) {
      withTools += 1;
      toolsDeclChars += String(fields.tools).length;
      toolCounts[tools.length] = (toolCounts[tools.length] || 0) + 1;
      rows.push({ file: rel, tools });
    } else {
      missing.push(rel);
    }
  }

  return {
    files: files.length,
    withTools,
    missing,
    toolCounts,
    rows,
    // ~chars/4, same estimate rule the token tracker uses.
    toolsDeclTokens: Math.ceil(toolsDeclChars / 4),
  };
}

function auditExampleConfig() {
  const raw = fs.readFileSync(EXAMPLE_CONFIG, "utf8");
  const cfg = JSON.parse(raw);
  const actionCounts = {};
  let actionLines = 0;
  for (const m of raw.matchAll(/"action":\s*"([^"]+)"/g)) {
    actionLines += 1;
    actionCounts[m[1]] = (actionCounts[m[1]] || 0) + 1;
  }
  return {
    topPermissions: Array.isArray(cfg.permissions) ? cfg.permissions.length : 0,
    agents: cfg.agents && typeof cfg.agents === "object" ? Object.keys(cfg.agents).length : 0,
    actionLines,
    actionCounts,
    compaction: cfg.compaction && typeof cfg.compaction === "object" ? Object.keys(cfg.compaction).join(",") : "(absent)",
    toolOutput: cfg.tool_output && typeof cfg.tool_output === "object" ? Object.keys(cfg.tool_output).join(",") : "(absent)",
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const agents = auditAgents();
  const config = auditExampleConfig();

  console.log("=== Tool surface audit (report-only) ===\n");

  console.log(`Agent tree: ${path.relative(ROOT, AGENT_ROOT).replace(/\\/g, "/")}`);
  console.log(`  files: ${agents.files} — with tools: ${agents.withTools}, without: ${agents.missing.length}`);
  const dist = Object.keys(agents.toolCounts)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => `${k} tools -> ${agents.toolCounts[k]} agents`);
  console.log(`  distribution: ${dist.join("; ") || "(none)"}`);
  console.log(`  tools: frontmatter declaration ~${agents.toolsDeclTokens} tokens across the tree`);
  const widest = agents.rows.slice().sort((a, b) => b.tools.length - a.tools.length).slice(0, 5);
  if (widest.length > 0) {
    console.log(`  widest surfaces: ${widest.map((r) => `${r.file} (${r.tools.length})`).join(", ")}`);
  }
  if (agents.missing.length > 0) {
    console.log(`  files without a tools: allowlist: ${agents.missing.join(", ")}`);
  }

  console.log(`\nConfig: ${path.relative(ROOT, EXAMPLE_CONFIG).replace(/\\/g, "/")}`);
  console.log(`  agents declared: ${config.agents}; top-level permissions[]: ${config.topPermissions}`);
  console.log(`  permission action rules: ${config.actionLines} (${Object.entries(config.actionCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")})`);
  console.log(`  compaction keys: ${config.compaction}; tool_output keys: ${config.toolOutput}`);

  const maxTools = agents.rows.reduce((max, r) => Math.max(max, r.tools.length), 0);
  console.log(`\nMax tools on one agent: ${maxTools}`);

  if (args.failOver != null) {
    const over = agents.rows.filter((r) => r.tools.length > args.failOver);
    if (over.length > 0) {
      console.error(`\nFAIL --fail-over ${args.failOver}: ${over.length} agent(s) exceed the cap:`);
      for (const r of over.slice(0, 10)) console.error(`  ${r.file}: ${r.tools.length} tools`);
      if (over.length > 10) console.error(`  ... and ${over.length - 10} more`);
      process.exit(1);
    }
    console.log(`\nPASS --fail-over ${args.failOver}: every agent is within the cap.`);
  } else {
    console.log("\nReport-only: pass --fail-over <n> to gate on per-agent tool count.");
  }
}

main();
