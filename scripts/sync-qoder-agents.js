#!/usr/bin/env node
"use strict";

/**
 * Sync Cursor agents → Qoder CLI agents (frontmatter conversion).
 * Mirrors scripts/sync-opencode-agents.js, targeting the Qoder agent format
 * (~/.qoder/agents/*.md — markdown + YAML frontmatter; agents are invoked via
 * the Agent tool with subagent_type = name).
 *
 * Usage: node scripts/sync-qoder-agents.js [--check]
 *   --check  exit 1 with a drift list if on-disk output differs from generated
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "bundle", "agents");
const DEST = path.join(ROOT, "bundle", "qoder", "agents");

/** Qoder description hard limit (chars). */
const MAX_DESCRIPTION = 1024;

/** Default turn budget — same default the opencode sync applies to steps. */
const DEFAULT_MAX_TURNS = 200;

/** Cursor readonly:true → Qoder tool denylist (Bash stays allowed, matching
 *  OpenCode's edit:deny + bash:allow). */
const READONLY_DISALLOWED_TOOLS = "[Write, Edit, NotebookEdit]";

/** Qoder readonly:false → per-agent permission mode that auto-approves file
 *  edits (scoped to the agent, not to global settings). */
const WRITABLE_PERMISSION_MODE = "acceptEdits";

function splitFrontmatter(raw) {
  if (!raw.startsWith("---")) return { fm: null, body: raw };
  const lines = raw.split(/\r?\n/);
  if (lines[0].trim() !== "---") return { fm: null, body: raw };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) return { fm: null, body: raw };
  const fm = lines.slice(1, end).join("\n");
  const body = lines.slice(end + 1).join("\n").replace(/^\n/, "");
  return { fm, body };
}

function parseFmFields(fm) {
  const fields = {};
  const lines = fm.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1];
    const rest = m[2].trim();
    if (/^[>|]-?$/.test(rest)) {
      const chunk = [];
      i++;
      while (i < lines.length && /^(  |\t)/.test(lines[i])) {
        chunk.push(lines[i].replace(/^\s+/, ""));
        i++;
      }
      fields[key] = chunk.join(" ").replace(/\s+/g, " ").trim();
      continue;
    }
    if (rest === "true") fields[key] = true;
    else if (rest === "false") fields[key] = false;
    else fields[key] = rest.replace(/^["']|["']$/g, "");
    i++;
  }
  return fields;
}

function foldDescription(desc) {
  const words = desc.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > 72 && cur) {
      lines.push(`  ${cur}`);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) lines.push(`  ${cur}`);
  return lines.join("\n");
}

/** Enforce Qoder's 1024-char description cap; truncate at a word boundary. */
function clampDescription(desc) {
  if (desc.length <= MAX_DESCRIPTION) return desc;
  let cut = desc.slice(0, MAX_DESCRIPTION - 1);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > 0) cut = cut.slice(0, lastSpace);
  return `${cut.replace(/[,;.\s]+$/, "")}…`;
}

function toQoderMarkdown(raw, fallbackName) {
  const { fm, body } = splitFrontmatter(raw);
  if (!fm) return raw;
  const fields = parseFmFields(fm);
  const name = fields.name || fallbackName;
  const description = clampDescription(fields.description || "Orchestra agent. Use proactively when this phase is active.");
  const readonly = fields.readonly === true;
  const maxTurns = parseInt(fields.steps, 10) || DEFAULT_MAX_TURNS;

  // Cursor-only fields are dropped: readonly (→ disallowedTools), steps
  // (→ maxTurns), mode (Qoder has no primary/subagent split — every agent is
  // invoked via the Agent tool), permission (Cursor/OpenCode-specific), and
  // model/reasoningEffort (agents inherit the session model — do not emit).
  // color is kept: Qoder supports it.
  let front = `---\nname: ${name}\ndescription: >-\n${foldDescription(description)}\n`;
  if (readonly) {
    front += `disallowedTools: ${READONLY_DISALLOWED_TOOLS}\n`;
  } else {
    // Writable agents must auto-approve edits — without this, a headless run
    // turns every Write/Edit ask into a silent deny (docs: permission pipeline).
    front += `permissionMode: ${WRITABLE_PERMISSION_MODE}\n`;
  }
  front += `maxTurns: ${maxTurns}\n`;
  // Preserve a source tools allowlist verbatim when present (none today).
  if (typeof fields.tools === "string" && fields.tools) front += `tools: ${fields.tools}\n`;
  if (typeof fields.color === "string" && fields.color) front += `color: ${fields.color}\n`;
  front += `---\n\n`;
  return front + body;
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.name.endsWith(".md")) files.push(full);
  }
  return files;
}

/** Shared references copied verbatim (spawn matrix only — same decision as
 *  sync-opencode-agents.js: legacy identity files are NOT mirrored). */
const SHARED_REFS = ["orchestra-spawn-matrix.md"];

/** Build the full expected output map (relative path → content). */
function generate() {
  const out = new Map();
  const refSrc = path.join(SRC, "references");
  for (const name of SHARED_REFS) {
    const srcPath = path.join(refSrc, name);
    if (!fs.existsSync(srcPath)) continue;
    out.set(path.join("references", name), fs.readFileSync(srcPath, "utf8"));
  }
  for (const src of walk(SRC)) {
    const rel = path.relative(SRC, src);
    if (rel.startsWith("references" + path.sep)) continue;
    // Conscious deviation from sync-opencode-agents.js: that script skips
    // orchestra.md (Cursor's primary conductor) and protects existing core
    // agents unless --force-core. Qoder has no separate primary-agent
    // mechanism and no hand-edited mirror to protect, so ALL agents —
    // conductor and core phases included — are converted every run.
    const raw = fs.readFileSync(src, "utf8");
    const fallbackName = path.basename(src, ".md");
    out.set(rel.split(path.sep).join("/"), toQoderMarkdown(raw, fallbackName));
  }
  return out;
}

function main() {
  const check = process.argv.includes("--check");
  const expected = generate();

  if (check) {
    const drift = [];
    for (const [rel, content] of expected) {
      const dest = path.join(DEST, rel);
      if (!fs.existsSync(dest)) {
        drift.push(`missing: bundle/qoder/agents/${rel}`);
      } else if (fs.readFileSync(dest, "utf8") !== content) {
        drift.push(`differs: bundle/qoder/agents/${rel}`);
      }
    }
    if (fs.existsSync(DEST)) {
      for (const file of walk(DEST)) {
        const rel = path.relative(DEST, file).split(path.sep).join("/");
        if (!expected.has(rel)) drift.push(`stale: bundle/qoder/agents/${rel}`);
      }
    }
    if (drift.length > 0) {
      console.error("Qoder agent mirror drift (run: node scripts/sync-qoder-agents.js):");
      for (const line of drift) console.error(`  ${line}`);
      process.exit(1);
    }
    console.log(`No drift. ${expected.size} files up to date under bundle/qoder/agents/`);
    return;
  }

  let written = 0;
  let unchanged = 0;
  for (const [rel, content] of expected) {
    const dest = path.join(DEST, rel);
    // Conditional write keeps re-runs byte- and mtime-idempotent.
    if (fs.existsSync(dest) && fs.readFileSync(dest, "utf8") === content) {
      unchanged++;
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
    written++;
    console.log("wrote", path.join("bundle/qoder/agents", rel));
  }
  console.log(`\nDone. wrote=${written} unchanged=${unchanged}`);
}

main();
