#!/usr/bin/env node
"use strict";

/**
 * Capability enricher — makes every agent's tool surface explicit.
 *
 * Source of truth stays in bundle/agents (Cursor tree). Policy derived from
 * fields that already exist there:
 *   - mode: primary conductors → no tools key (inherit everything, incl. Agent)
 *   - readonly: true           → Bash, Read, Grep, Glob, WebFetch, WebSearch
 *   - writable (no readonly)   → Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch
 *
 * Writes `tools:` into each agent's frontmatter (idempotent; existing value is
 * corrected to match policy). Derived trees are regenerated afterwards with
 * scripts/sync-qoder-agents.js + scripts/sync-opencode-agents.js.
 *
 * Usage: node scripts/enrich-agent-capabilities.js [--check]
 *   --check  exit 1 listing every file whose tools value drifts from policy
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "bundle", "agents");

const READONLY_TOOLS = "Bash, Read, Grep, Glob, WebFetch, WebSearch";
const WRITABLE_TOOLS = "Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch";

/** Conductors must inherit full access (they spawn subagents). */
const INHERIT = new Set(["orchestra.md", "workflow-orchestrator.md"]);

function listAgents() {
  const out = [];
  for (const entry of fs.readdirSync(SRC, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== "references") {
      for (const f of fs.readdirSync(path.join(SRC, entry.name))) {
        if (f.endsWith(".md")) out.push(path.join(SRC, entry.name, f));
      }
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(path.join(SRC, entry.name));
    }
  }
  return out.sort();
}

function fmRange(lines) {
  if (!lines[0] || lines[0].trim() !== "---") return null;
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === "---") return { start: 1, end: i };
  return null;
}

function fieldOf(fmLines, key) {
  const re = new RegExp(`^${key}:\\s*(.*)$`);
  for (const l of fmLines) {
    const m = l.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

function policy(file) {
  if (INHERIT.has(path.basename(file))) return null;
  const raw = fs.readFileSync(file, "utf8");
  const lines = raw.split(/\r?\n/);
  const fm = fmRange(lines);
  if (!fm) return undefined; // no frontmatter — skip
  const fmLines = lines.slice(fm.start, fm.end);
  const readonly = fieldOf(fmLines, "readonly") === "true";
  return { lines, fm, want: readonly ? READONLY_TOOLS : WRITABLE_TOOLS };
}

const check = process.argv.includes("--check");
const drift = [];
let changed = 0;

for (const file of listAgents()) {
  const p = policy(file);
  if (p === undefined) continue;
  if (p === null) {
    // conductor: ensure NO tools key
    const cl = fs.readFileSync(file, "utf8").split(/\r?\n/);
    const cf = fmRange(cl);
    if (!cf) continue;
    const existingIdx = cl.slice(cf.start, cf.end).findIndex((l) => /^tools:/.test(l));
    if (existingIdx !== -1) {
      if (check) { drift.push(file + " (conductor must inherit; has tools)"); continue; }
      cl.splice(cf.start + existingIdx, 1);
      fs.writeFileSync(file, cl.join("\n"));
      changed++;
    }
    continue;
  }
  const { lines, fm } = p;
  const fmLines = lines.slice(fm.start, fm.end);
  const existingIdx = fmLines.findIndex((l) => /^tools:/.test(l));
  const existing = existingIdx !== -1 ? fmLines[existingIdx].replace(/^tools:\s*/, "").trim() : null;

  if (existing === p.want) continue;
  if (check) { drift.push(`${file} (tools: ${existing || "missing"} → want ${p.want})`); continue; }
  if (existingIdx !== -1) lines[fm.start + existingIdx] = `tools: ${p.want}`;
  else lines.splice(fm.end, 0, `tools: ${p.want}`);
  fs.writeFileSync(file, lines.join("\n"));
  changed++;
}

if (check) {
  if (drift.length) {
    console.error(`agent-capabilities drift (${drift.length}):`);
    drift.forEach((d) => console.error("  " + d));
    process.exit(1);
  }
  console.log("agent capabilities: in sync");
} else {
  const total = listAgents().length;
  console.log(`enriched ${changed} files (of ${total} agents)`);
}
