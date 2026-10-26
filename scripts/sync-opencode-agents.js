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

function toOpenCodeMarkdown(raw, fallbackSteps) {
  const { fm, body } = splitFrontmatter(raw);
  if (!fm) return raw;
  const fields = parseFmFields(fm);
  const name = fields.name || "unnamed";
  const description = ensureProactive(fields.description || "");
  const readonly = fields.readonly === true;
  const steps = parseInt(fields.steps, 10) || fallbackSteps || 200;

  // Agents inherit the main/global model — do not emit per-agent model.
  // Preserve invested OpenCode-only settings (steps, no-ask bash, search) so
  // re-running the sync never clobbers them back to ask/stale budgets.
  let front = `---\nname: ${name}\ndescription: >-\n${foldDescription(description)}\nmode: subagent\nsteps: ${steps}\n`;
  front += `permission:\n  edit: ${readonly ? "deny" : "allow"}\n  bash: allow\n  websearch: allow\n  webfetch: allow\n`;
  front += `---\n\n`;
  return front + body;
}

/** Keep the step budget already invested in an existing mirror file. */
function existingSteps(dest) {
  try {
    const { fm } = splitFrontmatter(fs.readFileSync(dest, "utf8"));
    if (!fm) return null;
    const steps = parseInt(parseFmFields(fm).steps, 10);
    return Number.isFinite(steps) ? steps : null;
  } catch {
    return null;
  }
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.name.endsWith(".md")) files.push(full);
  }
  return files;
}

/** Relative path → generated content for every mirror file. */
function generate() {
  const out = new Map();
  const refSrc = path.join(SRC, "references");
  for (const name of ["orchestra-spawn-matrix.md"]) {
    const srcPath = path.join(refSrc, name);
    if (fs.existsSync(srcPath)) out.set(path.join("references", name), fs.readFileSync(srcPath, "utf8"));
  }
  for (const src of walk(SRC)) {
    const rel = path.relative(SRC, src);
    if (rel.startsWith("references" + path.sep)) continue;
    // Cursor's primary conductor has no OpenCode mirror.
    if (path.basename(src) === "orchestra.md") continue;
    const dest = path.join(DEST, rel);
    out.set(rel, toOpenCodeMarkdown(fs.readFileSync(src, "utf8"), existingSteps(dest)));
  }
  return out;
}

function main() {
  const forceCore = process.argv.includes("--force-core");
  const check = process.argv.includes("--check");
  const expected = generate();

  if (check) {
    const drift = [];
    for (const [rel, content] of expected) {
      const dest = path.join(DEST, rel);
      if (!fs.existsSync(dest)) drift.push(`missing: bundle/opencode/agents/${rel.split(path.sep).join("/")}`);
      else if (fs.readFileSync(dest, "utf8") !== content) drift.push(`differs: bundle/opencode/agents/${rel.split(path.sep).join("/")}`);
    }
    if (fs.existsSync(DEST)) {
      for (const file of walk(DEST)) {
        const rel = path.relative(DEST, file);
        // orchestra.md is OpenCode-primary by design; the rest must be generated.
        if (rel === "orchestra.md" || expected.has(rel)) continue;
        // Legacy identity notes predate the mirror and are not managed here.
        if (/^references[\\/]orchestra-.*-identity\.md$/.test(rel)) continue;
        drift.push(`stale: bundle/opencode/agents/${rel.split(path.sep).join("/")}`);
      }
    }
    if (drift.length > 0) {
      console.error("OpenCode agent mirror drift (run: node scripts/sync-opencode-agents.js --force-core):");
      for (const line of drift) console.error(`  ${line}`);
      process.exit(1);
    }
    console.log(`No drift. ${expected.size} files up to date under bundle/opencode/agents/`);
    return;
  }

  let written = 0;
  let unchanged = 0;
  let skipped = 0;
  for (const [rel, content] of expected) {
    const dest = path.join(DEST, rel);
    const isCore = CORE_NAMES.has(path.basename(rel));
    if (isCore && fs.existsSync(dest) && !forceCore) {
      skipped++;
      continue;
    }
    if (fs.existsSync(dest) && fs.readFileSync(dest, "utf8") === content) {
      unchanged++;
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
    written++;
    console.log("wrote", path.relative(ROOT, dest));
  }

  console.log(`\nDone. wrote=${written} unchanged=${unchanged} skipped_core_existing=${skipped}`);
  if (skipped > 0) console.log("Tip: re-run with --force-core to overwrite core agents.");
}

main();
