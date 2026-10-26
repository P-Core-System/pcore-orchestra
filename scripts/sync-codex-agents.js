#!/usr/bin/env node
"use strict";

/**
 * Sync Cursor agents → Codex CLI custom agents.
 *
 * Codex custom agents are TOML files under ~/.codex/agents/<name>.toml with
 * `name`, `description`, and `developer_instructions`. The mirror is flat
 * (Codex keys agents by name) and drops Cursor-only keys; sandbox/approval
 * policy is inherited from the parent session.
 *
 * Usage: node scripts/sync-codex-agents.js [--check]
 *   --check  exit 1 with a drift list if on-disk output differs from generated
 */

const fs = require("node:fs");
const path = require("node:path");
const {
  splitFrontmatter,
  parseFmFields,
  clampDescription,
  walkMarkdown,
} = require("./lib/agent-frontmatter.js");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "bundle", "agents");
const DEST = path.join(ROOT, "bundle", "codex", "agents");

const MAX_DESCRIPTION = 1024;

/** Single-line TOML basic string. JSON string escapes are valid TOML escapes. */
function tomlString(value) {
  return JSON.stringify(value);
}

function normalizeBody(body) {
  const text = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return text.endsWith("\n") ? text : `${text}\n`;
}

/**
 * Emit developer_instructions as a TOML multi-line literal string when the
 * body has no `'''` (preserves backslashes in code samples verbatim), else a
 * multi-line basic string with backslash/quote escapes.
 */
function tomlInstructions(body) {
  const text = normalizeBody(body);
  if (!text.includes("'''")) {
    // TOML trims the newline immediately after the opening delimiter.
    return `'''\n${text}'''`;
  }
  const escaped = text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\t/g, "\\t");
  return `"""\n${escaped}"""`;
}

function toCodexToml(raw, fallbackName) {
  const { fm, body } = splitFrontmatter(raw);
  if (!fm) return raw;
  const fields = parseFmFields(fm);
  const name = fields.name || fallbackName;
  const description = clampDescription(
    fields.description || "Orchestra agent. Use proactively when this phase is active.",
    MAX_DESCRIPTION
  );
  return [
    `name = ${tomlString(name)}`,
    `description = ${tomlString(description)}`,
    "",
    `developer_instructions = ${tomlInstructions(body)}`,
    "",
  ].join("\n");
}

/** Flat `<name>.toml` → generated content. Throws on duplicate basenames. */
function generate() {
  const out = new Map();
  for (const src of walkMarkdown(SRC)) {
    const rel = path.relative(SRC, src);
    if (rel.startsWith("references" + path.sep)) continue;
    const stem = path.basename(src, ".md");
    const fileName = `${stem}.toml`;
    if (out.has(fileName)) {
      throw new Error(`duplicate agent basename "${stem}" — Codex agents are flat`);
    }
    out.set(fileName, toCodexToml(fs.readFileSync(src, "utf8"), stem));
  }
  return out;
}

function walkToml(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkToml(full, files);
    else if (entry.name.endsWith(".toml")) files.push(full);
  }
  return files;
}

function main() {
  const check = process.argv.includes("--check");
  const expected = generate();

  if (check) {
    const drift = [];
    for (const [rel, content] of expected) {
      const dest = path.join(DEST, rel);
      if (!fs.existsSync(dest)) drift.push(`missing: bundle/codex/agents/${rel}`);
      else if (fs.readFileSync(dest, "utf8") !== content) drift.push(`differs: bundle/codex/agents/${rel}`);
    }
    if (fs.existsSync(DEST)) {
      for (const file of walkToml(DEST)) {
        const rel = path.relative(DEST, file).split(path.sep).join("/");
        if (!expected.has(rel)) drift.push(`stale: bundle/codex/agents/${rel}`);
      }
    }
    if (drift.length > 0) {
      console.error("Codex agent mirror drift (run: node scripts/sync-codex-agents.js):");
      for (const line of drift) console.error(`  ${line}`);
      process.exit(1);
    }
    console.log(`No drift. ${expected.size} files up to date under bundle/codex/agents/`);
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
    console.log("wrote", path.join("bundle/codex/agents", rel));
  }
  console.log(`\nDone. wrote=${written} unchanged=${unchanged}`);
}

main();
