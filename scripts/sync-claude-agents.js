#!/usr/bin/env node
"use strict";

/**
 * Sync Cursor agents → Claude Code subagents.
 *
 * Claude Code discovers user subagents under ~/.claude/agents/<name>.md with
 * `name`, `description`, `tools`, and optional `model` frontmatter. This mirror
 * is flat (one file per agent, unique basenames) so discovery does not depend
 * on recursive directory support, and it drops Cursor-only keys (`readonly`,
 * `steps`, `model`) so agents inherit the session model.
 *
 * Usage: node scripts/sync-claude-agents.js [--check]
 *   --check  exit 1 with a drift list if on-disk output differs from generated
 */

const fs = require("node:fs");
const path = require("node:path");
const {
  splitFrontmatter,
  parseFmFields,
  foldDescription,
  clampDescription,
  walkMarkdown,
} = require("./lib/agent-frontmatter.js");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "bundle", "agents");
const DEST = path.join(ROOT, "bundle", "claude", "agents");

const MAX_DESCRIPTION = 1024;
const READONLY_DISALLOWED_TOOLS = "Write, Edit, NotebookEdit";
const WRITABLE_PERMISSION_MODE = "acceptEdits";

function toClaudeMarkdown(raw, fallbackName) {
  const { fm, body } = splitFrontmatter(raw);
  if (!fm) return raw;
  const fields = parseFmFields(fm);
  const name = fields.name || fallbackName;
  const description = clampDescription(
    fields.description || "Orchestra agent. Use proactively when this phase is active.",
    MAX_DESCRIPTION
  );
  const readonly = fields.readonly === true;

  let front = `---\nname: ${name}\ndescription: >-\n${foldDescription(description)}\n`;
  if (readonly) {
    // Denylist (not a tools allowlist) keeps the host's full read/shell surface
    // while preventing a research agent from editing the workspace.
    front += `disallowedTools: ${READONLY_DISALLOWED_TOOLS}\n`;
  } else {
    front += `permissionMode: ${WRITABLE_PERMISSION_MODE}\n`;
  }
  if (typeof fields.tools === "string" && fields.tools) front += `tools: ${fields.tools}\n`;
  if (typeof fields.color === "string" && fields.color) front += `color: ${fields.color}\n`;
  front += `---\n\n`;
  return front + body;
}

/** Flat relative path → generated content. Throws on duplicate basenames. */
function generate() {
  const out = new Map();
  for (const src of walkMarkdown(SRC)) {
    const rel = path.relative(SRC, src);
    if (rel.startsWith("references" + path.sep)) continue;
    const fileName = path.basename(src);
    if (out.has(fileName)) {
      throw new Error(`duplicate agent basename "${fileName}" — Claude Code agents are flat`);
    }
    out.set(fileName, toClaudeMarkdown(fs.readFileSync(src, "utf8"), path.basename(src, ".md")));
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
      if (!fs.existsSync(dest)) drift.push(`missing: bundle/claude/agents/${rel}`);
      else if (fs.readFileSync(dest, "utf8") !== content) drift.push(`differs: bundle/claude/agents/${rel}`);
    }
    if (fs.existsSync(DEST)) {
      for (const file of walkMarkdown(DEST)) {
        const rel = path.relative(DEST, file).split(path.sep).join("/");
        if (!expected.has(rel)) drift.push(`stale: bundle/claude/agents/${rel}`);
      }
    }
    if (drift.length > 0) {
      console.error("Claude Code agent mirror drift (run: node scripts/sync-claude-agents.js):");
      for (const line of drift) console.error(`  ${line}`);
      process.exit(1);
    }
    console.log(`No drift. ${expected.size} files up to date under bundle/claude/agents/`);
    return;
  }

  let written = 0;
  let unchanged = 0;
  for (const [rel, content] of expected) {
    const dest = path.join(DEST, rel);
    if (fs.existsSync(dest) && fs.readFileSync(dest, "utf8") === content) {
      unchanged++;
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
    written++;
    console.log("wrote", path.join("bundle/claude/agents", rel));
  }
  console.log(`\nDone. wrote=${written} unchanged=${unchanged}`);
}

main();
