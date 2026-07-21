#!/usr/bin/env node
"use strict";

/**
 * Sync Cursor agents → OpenCode agents (frontmatter conversion).
 * Usage: node scripts/sync-opencode-agents.js
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "bundle", "agents");
const DEST = path.join(ROOT, "bundle", "opencode", "agents");

const CORE_NAMES = new Set([
  "orchestra-planner.md",
  "orchestra-implementer.md",
  "orchestra-verifier.md",
  "orchestra-reviewer.md",
]);

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

function ensureProactive(desc) {
  if (!desc) return "Orchestra specialist. Use proactively when this phase is active.";
  if (/use proactively/i.test(desc)) return desc;
  return `${desc} Use proactively when this specialist's phase is active.`;
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

function toOpenCodeMarkdown(raw) {
  const { fm, body } = splitFrontmatter(raw);
  if (!fm) return raw;
  const fields = parseFmFields(fm);
  const name = fields.name || "unnamed";
  const description = ensureProactive(fields.description || "");
  const readonly = fields.readonly === true;

  let front = `---\nname: ${name}\ndescription: >-\n${foldDescription(description)}\nmode: subagent\n`;
  if (readonly) {
    front += `permission:\n  edit: deny\n  bash: ask\n`;
  }
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

function main() {
  const sources = walk(SRC);
  let written = 0;
  let skipped = 0;

  for (const src of sources) {
    const rel = path.relative(SRC, src);
    const dest = path.join(DEST, rel);
    const isCore = CORE_NAMES.has(path.basename(src));

    if (isCore && fs.existsSync(dest)) {
      skipped++;
      continue;
    }

    const raw = fs.readFileSync(src, "utf8");
    const converted = toOpenCodeMarkdown(raw);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, converted);
    written++;
    console.log("wrote", path.relative(ROOT, dest));
  }

  console.log(`\nDone. wrote=${written} skipped_core_existing=${skipped}`);
}

main();
