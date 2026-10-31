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

// #38: The Cursor/OpenCode source bodies carry a `## Model` (root orchestra agents)
// or `## Models` (category agents) section that names Cursor's model pool
// (`composer-2.5`, `grok-4.6`, "Other Models") and the Cursor Task vs OpenCode spawn
// note. None of that applies under Codex, where a custom agent inherits the session
// model. Rewrite that one section to a Codex-neutral note, then scrub any stray
// Cursor-specific tokens so no generated TOML mentions them.
const CODEX_MODEL_SECTION =
  "## Model\n\n" +
  "Codex uses the model configured for the session (see `~/.codex/config.toml` or the " +
  "Codex CLI `--model` flag); Orchestra does not pin a per-agent model in this file.\n\n";

function isModelHeading(line) {
  return /^##\s+Models?\s*$/.test(line);
}

function rewriteModelSection(body) {
  const lines = body.split("\n");
  const out = [];
  let i = 0;
  let replaced = false;
  while (i < lines.length) {
    if (isModelHeading(lines[i])) {
      // Collect the section body up to the next top-level `## ` heading or EOF.
      let j = i + 1;
      const section = [];
      while (j < lines.length && !/^##\s+/.test(lines[j])) {
        section.push(lines[j]);
        j++;
      }
      if (!replaced) {
        out.push(CODEX_MODEL_SECTION.replace(/\n$/, ""));
        // Preserve role lines ("You are the … subagent") that merely sat in the
        // model section; drop the Cursor/OpenCode pool + spawn guidance around them.
        for (const l of section) {
          if (/^\s*You are the\b/i.test(l)) out.push("", l.trim(), "");
        }
        replaced = true;
      }
      i = j;
      continue;
    }
    out.push(lines[i]);
    i++;
  }
  return out.join("\n");
}

function scrubCursorTokens(body) {
  return body
    .replace(/Cursor\s+Task\s+vs\s+OpenCode\s+task/gi, "Codex `spawn_agent`")
    .replace(/\(\s*Cursor\s+Task\s+vs\s+OpenCode\s+task\s*\)/gi, "(Codex spawn_agent)")
    .replace(/references\/orchestra-spawn-matrix\.md/g, "Codex spawn_agent")
    .replace(/Cursor\s+Models?\s+pool/gi, "the session model")
    .replace(/Cursor\s+Agent/g, "the agent")
    .replace(/Cursor\s+Models\b/g, "the model pool")
    .replace(/\bcomposer-2\.5\b/gi, "the session model")
    .replace(/\bgrok-4\.6\b/gi, "a stronger model")
    .replace(/Other\s+Models\s+pool/gi, "the alternate-model pool")
    .replace(/\bOther\s+Models\b/g, "alternate models");
}

function codexifyBody(body) {
  return scrubCursorTokens(rewriteModelSection(body));
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
    scrubCursorTokens(fields.description || "Orchestra agent. Use proactively when this phase is active."),
    MAX_DESCRIPTION
  );
  return [
    `name = ${tomlString(name)}`,
    `description = ${tomlString(description)}`,
    "",
    `developer_instructions = ${tomlInstructions(codexifyBody(body))}`,
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
