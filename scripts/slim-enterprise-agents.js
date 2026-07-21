#!/usr/bin/env node
"use strict";

/**
 * Slim enterprise agent markdown: keep contracts, drop personality fluff.
 * Usage: node scripts/slim-enterprise-agents.js
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "bundle", "agents");
const DROP = new Set([
  "Personality",
  "Strengths",
  "Weaknesses",
  "Teammate Feedback",
  "When NOT to Deploy",
]);

function walk(dir, files = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, files);
    else if (e.name.endsWith(".md") && !e.name.startsWith("orchestra-")) files.push(f);
  }
  return files;
}

function slim(raw) {
  const lines = raw.split(/\r?\n/);
  const out = [];
  let i = 0;
  let identityName = "";
  let identityTeam = "";

  while (i < lines.length) {
    const line = lines[i];
    const h2 = line.match(/^##\s+(.+)\s*$/);
    if (h2) {
      const title = h2[1].trim();
      if (DROP.has(title)) {
        i++;
        while (i < lines.length && !/^##\s+/.test(lines[i])) i++;
        continue;
      }
      if (title === "Identity") {
        i++;
        while (i < lines.length && !/^##\s+/.test(lines[i])) {
          const mName = lines[i].match(/\*\*Human Name:\*\*\s*(.+)/);
          const mTeam = lines[i].match(/\*\*Team:\*\*\s*(.+)/);
          if (mName) identityName = mName[1].trim();
          if (mTeam) identityTeam = mTeam[1].trim();
          i++;
        }
        if (identityName || identityTeam) {
          out.push("## Identity");
          out.push(
            `- ${[identityName, identityTeam].filter(Boolean).join(" · ")}`
          );
          out.push("");
        }
        continue;
      }
      if (title === "When to Deploy") {
        out.push("## When to Deploy");
        i++;
        while (i < lines.length && !/^##\s+/.test(lines[i])) {
          if (lines[i].trim()) out.push(lines[i]);
          i++;
        }
        out.push("");
        continue;
      }
    }
    out.push(line);
    i++;
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

let n = 0;
for (const file of walk(ROOT)) {
  const before = fs.readFileSync(file, "utf8");
  const after = slim(before);
  if (after !== before) {
    fs.writeFileSync(file, after);
    n++;
    console.log("slimmed", path.relative(path.join(__dirname, ".."), file), `${before.length}→${after.length}`);
  }
}
console.log(`Done. slimmed=${n}`);
