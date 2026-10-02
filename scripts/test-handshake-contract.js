#!/usr/bin/env node
"use strict";

/**
 * Step 5 self-check: ORCHESTRA/1 handshake contract.
 *
 * The conductor (bundle/agents/orchestra.md) parses a workflow agent's end
 * token to decide what to run next. Agent and conductor must agree on the
 * token; the pre-contract spellings survive only as documented legacy aliases.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const CONDUCTOR = path.join(ROOT, "bundle", "agents", "orchestra.md");

let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function read(rel) {
  return fs.readFileSync(path.isAbsolute(rel) ? rel : path.join(ROOT, rel), "utf8");
}

function body(text) {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
  return (m ? text.slice(m[0].length) : text).replace(/\r\n/g, "\n").trim();
}

const PAIRS = [
  { agent: "agent-selector", rel: "bundle/agents/00-workflow/agent-selector.md", token: "TEAM_SELECTED", legacy: "AGENTS_SELECTED" },
  { agent: "project-type-classifier", rel: "bundle/agents/00-workflow/project-type-classifier.md", token: "PROJECT_CLASSIFIED", legacy: null },
  { agent: "workflow-orchestrator", rel: "bundle/agents/00-workflow/workflow-orchestrator.md", token: "WORKFLOW_PLAN_READY", legacy: "WORKFLOW_ORCHESTRATED" },
];

const conductor = read(CONDUCTOR);
const conductorLines = conductor.split(/\r?\n/);

for (const p of PAIRS) {
  const row = conductorLines.find((l) => l.includes("**task**") && l.includes(`\`${p.agent}\``));
  check(`conductor row for ${p.agent} exists`, !!row, p.agent);
  check(
    `conductor row for ${p.agent} expects ${p.token}`,
    !!row && row.includes(p.token),
    row ? row.trim().slice(0, 220) : "no row"
  );

  const cursor = read(p.rel);
  const opencodeRel = p.rel.replace(/^bundle\//, "bundle/opencode/");
  const opencode = read(opencodeRel);

  check(
    `${p.agent}: cursor ends with ${p.token}`,
    new RegExp("End with `" + p.token + "`").test(cursor),
    (cursor.match(/End with [^\n]*/) || ["no End-with line"])[0]
  );
  check(
    `${p.agent}: opencode ends with ${p.token}`,
    new RegExp("End with `" + p.token + "`").test(opencode),
    (opencode.match(/End with [^\n]*/) || ["no End-with line"])[0]
  );
  check(
    `${p.agent}: cursor and opencode bodies identical`,
    body(cursor) === body(opencode),
    `${body(cursor).length} vs ${body(opencode).length}`
  );

  if (p.legacy) {
    check(
      `${p.agent}: legacy ${p.legacy} is not the end token`,
      !new RegExp("End with `" + p.legacy + "`").test(cursor) &&
        !new RegExp("End with `" + p.legacy + "`").test(opencode)
    );
    const aliasLine = cursor.split(/\r?\n/).find((l) => l.includes(p.legacy) && /alias|legacy/i.test(l));
    check(
      `${p.agent}: legacy ${p.legacy} documented as an alias`,
      !!aliasLine,
      aliasLine || "no alias line"
    );
    check(
      `${p.agent}: legacy ${p.legacy} absent from opencode too`,
      body(opencode).includes(p.legacy) === !!body(cursor).includes(p.legacy)
    );
  }
}

// OpenCode conductor keeps its own body but must wait on the same three tokens
const opencodeConductor = read(path.join(ROOT, "bundle", "opencode", "agents", "orchestra.md"));
for (const p of PAIRS) {
  check(`opencode conductor expects ${p.token}`, opencodeConductor.includes(p.token), p.token);
}

// stale legacy spellings must not survive anywhere else in the agent bundle
function scan(dir) {
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) {
        const text = fs.readFileSync(p, "utf8");
        for (const bad of ["AGENTS_SELECTED", "WORKFLOW_ORCHESTRATED"]) {
          if (new RegExp("End with `" + bad + "`").test(text)) {
            hits.push(`${path.relative(ROOT, p)}:${bad}`);
          }
        }
      }
    }
  };
  walk(dir);
  return hits;
}

const stale = scan(path.join(ROOT, "bundle", "agents")).concat(scan(path.join(ROOT, "bundle", "opencode", "agents")));
check("no agent still ends with a legacy token", stale.length === 0, stale.join(", "));

// conductor and agents must not disagree on any other workflow end token either
const workflowDir = path.join(ROOT, "bundle", "agents", "00-workflow");
const mismatches = [];
for (const f of fs.readdirSync(workflowDir).filter((n) => n.endsWith(".md"))) {
  const text = fs.readFileSync(path.join(workflowDir, f), "utf8");
  const m = /End with `([A-Z_]+)`/.exec(text);
  if (!m) continue;
  const name = f.replace(/\.md$/, "");
  const row = conductorLines.find((l) => l.includes("**task**") && l.includes(`\`${name}\``));
  if (row && !row.includes(m[1])) {
    mismatches.push(`${name}: agent=${m[1]} conductor-row-has-no-token`);
  }
}
check("every workflow End-with token is on its conductor row", mismatches.length === 0, mismatches.join("; "));

console.log(failed === 0 ? "\nAll handshake contract tests passed." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
