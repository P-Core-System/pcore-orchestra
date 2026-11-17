#!/usr/bin/env node
"use strict";

/**
 * Orchestra context diet — make the per-request index pay for itself.
 *
 * Problem this fixes: OpenCode inlines the name+description of EVERY
 * non-hidden agent and EVERY discovered skill into the system prompt of every
 * request, on every model, including free pools. Measured on a live host:
 *
 *   182 agent rows  ~10.3K tok/request
 *   106 skill rows   ~8.6K tok/request   (102 of them are permission-DENIED
 *                                         yet still described every request)
 *   ------------------------------------
 *   fixed index     ~18.9K tok/request
 *
 * The loop only ever uses 4 skills and spawns agents by name, so ~18.6K of
 * that buys nothing. This tool moves unused definitions out of the indexed
 * surfaces into a lazy catalog that is read only when actually needed.
 *
 * Ownership rule (never violated): only orchestra-owned skills are touched.
 * Foreign skills (user-installed, other vendors) are reported, never moved.
 *
 * Usage:
 *   node scripts/orchestra-context-diet.js                 # report
 *   node scripts/orchestra-context-diet.js --apply         # apply to install
 *   node scripts/orchestra-context-diet.js --dry-run       # what --apply would do
 *   node scripts/orchestra-context-diet.js --check         # drift gate (exit 1)
 *   node scripts/orchestra-context-diet.js --restore       # undo skill moves
 *   node scripts/orchestra-context-diet.js --shared        # also unindex shared roots
 *   node scripts/orchestra-context-diet.js --trim-descriptions 180  # shorten OUR skill descriptions
 *   node scripts/orchestra-context-diet.js --bundle        # rewrite bundle mirrors
 */

const fs = require("node:fs");
const path = require("node:path");

const cb = require("./lib/context-budget.js");

const ROOT = path.join(__dirname, "..");
const CONFIG_DIR = cb.opencodeConfigDir();
const AGENTS_DIR = path.join(CONFIG_DIR, "agents");
const LAZY_DIR = path.join(CONFIG_DIR, "lazy");
const SKILL_CATALOG = path.join(LAZY_DIR, "skill-index.json");
const MANIFEST = path.join(LAZY_DIR, "diet-manifest.json");

/** Skill names shipped by this bundle (union of the three source trees). */
function bundleOwnedSkills() {
  const owned = new Set();
  for (const rel of ["bundle/skills", "bundle/opencode/skills", "bundle/skills-cursor"]) {
    const dir = path.join(ROOT, rel);
    let ents = [];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      if (fs.existsSync(path.join(dir, e.name, "SKILL.md"))) owned.add(e.name);
    }
  }
  return owned;
}

function isLink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Frontmatter that turns a doc file into an inert, hidden agent. */
const DOC_AGENT_FM = [
  "---",
  "name: __DOCNAME__",
  "description: Reference doc, not an agent. Read it; never spawn it.",
  "mode: subagent",
  "hidden: true",
  "---",
  "",
].join("\n");

/**
 * Insert `hidden: true` into an agent markdown frontmatter (idempotent).
 * @param {string} raw
 * @returns {{text:string, changed:boolean}}
 */
function withHidden(raw) {
  if (!/^---\r?\n/.test(raw)) return { text: raw, changed: false };
  if (/^hidden:[ \t]*true/m.test(raw)) return { text: raw, changed: false };
  const lines = raw.split(/\r?\n/);
  let anchor = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^---\s*$/.test(lines[i])) break;
    if (/^(mode|name|description):/.test(lines[i])) anchor = i;
    if (/^(steps|permission|model|color):/.test(lines[i])) {
      // insert just before the first post-identity block
      lines.splice(i, 0, "hidden: true");
      return { text: lines.join("\n"), changed: true };
    }
  }
  if (anchor >= 0) {
    lines.splice(anchor + 1, 0, "hidden: true");
    return { text: lines.join("\n"), changed: true };
  }
  return { text: raw, changed: false };
}

/** Walk a tree for .md files. */
function walkMd(dir, out = []) {
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && !isLink(full)) walkMd(full, out);
    else if (e.name.endsWith(".md")) out.push(full);
  }
  return out;
}

/**
 * Hide every subagent that is not on the visible allowlist.
 * @param {{apply:boolean, root?:string, log:(s:string)=>void}} opts
 */
function hideAgents(opts) {
  const root = opts.root || AGENTS_DIR;
  const log = opts.log || (() => {});
  let wouldHide = 0;
  let hidden = 0;
  let probes = 0;
  let docs = 0;
  let stale = 0;
  const STALE = [
    "references/orchestra-planner-identity.md",
    "references/orchestra-implementer-identity.md",
    "references/orchestra-verifier-identity.md",
    "references/orchestra-reviewer-identity.md",
  ];
  for (const file of walkMd(root)) {
    const base = path.basename(file);
    const rel = path.relative(root, file).split(path.sep).join("/");
    if (cb.JUNK_AGENT_BASENAMES.has(base)) {
      probes++;
      if (opts.apply) {
        fs.rmSync(file, { force: true });
        log(`pruned probe ${rel}`);
      } else log(`would prune probe ${base}`);
      continue;
    }
    // Leftover identity notes from before the SDLC migration: nothing installs
    // them anymore, but they still register as agents and cost index rows.
    if (STALE.includes(rel)) {
      stale++;
      if (opts.apply) {
        fs.rmSync(file, { force: true });
        log(`pruned stale mirror ${rel}`);
      }
      continue;
    }
    const raw = fs.readFileSync(file, "utf8");
    const fm = cb.parseAgentFrontmatter(raw);
    if (!fm || !fm.name) {
      // OpenCode registers EVERY .md under agents/ as an agent, including
      // reference docs, which then appear in the prompt index with a
      // path-derived name. Make them inert instead of pretending they are not
      // there.
      docs++;
      if (opts.apply) {
        const slug = rel.replace(/\.md$/, "").replace(/[^A-Za-z0-9_-]+/g, "-");
        fs.writeFileSync(file, DOC_AGENT_FM.replace("__DOCNAME__", slug) + raw);
        log(`neutralized doc-as-agent ${rel}`);
      }
      continue;
    }
    if (fm.mode && fm.mode !== "subagent") continue; // primary/system agents untouched
    if (!cb.isIndexHidden(fm.name, fm.mode || "subagent")) continue;
    if (fm.hidden) {
      hidden++;
      continue;
    }
    wouldHide++;
    if (opts.apply) {
      const { text, changed } = withHidden(raw);
      if (changed) fs.writeFileSync(file, text);
      log(`hid ${path.relative(root, file)}`);
    }
  }
  return { alreadyHidden: hidden, needHiding: wouldHide, probes, docs, stale };
}

/**
 * Write the lazy specialist routing table OUTSIDE any scanned tree. It cannot
 * live under agents/ (every .md there becomes an agent) and must not be in the
 * prompt (that is the cost being removed), so it lands in `<config>/lazy/`.
 * @param {{apply:boolean, log:(s:string)=>void}} opts
 */
function writeAgentIndex(opts) {
  const root = AGENTS_DIR;
  const rows = [];
  const walk = (d, prefix) => {
    let ents;
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full, prefix ? `${prefix}/${e.name}` : e.name);
      else if (e.name.endsWith(".md")) {
        const fm = cb.parseAgentFrontmatter(fs.readFileSync(full, "utf8"));
        if (!fm || !fm.name || !fm.hidden) continue;
        // OpenCode addresses nested agents by path-qualified id, bare names for root files.
        rows.push({ id: prefix ? `${prefix}/${path.basename(e.name, ".md")}` : path.basename(e.name, ".md") });
      }
    }
  };
  walk(root, "");
  rows.sort((a, b) => a.id.localeCompare(b.id));
  const md = cb.buildSpecialistIndex(rows);
  if (opts.apply) {
    fs.mkdirSync(LAZY_DIR, { recursive: true });
    fs.writeFileSync(path.join(LAZY_DIR, "agent-index.md"), md);
    (opts.log || (() => {}))(
      `agent routing index: ${rows.length} hidden specialists -> ${path.join(LAZY_DIR, "agent-index.md").replace(process.env.HOME || "", "~")}`
    );
  }
  return { ids: rows.length, tokens: cb.estimateTokens(md) };
}

/**
 * Move non-allowlisted orchestra-owned skills out of an indexed root into
 * `<config>/lazy/skills/<rootKey>/`, recorded in a catalog + manifest so the
 * move is reversible.
 *
 * SCOPE GUARD: by default only the OpenCode-owned root is pruned. The shared
 * discovery roots (~/.agents/skills, ~/.claude/skills) are how Codex and
 * Claude Code find their skills, so removing them there would break another
 * host's capability rather than just its prompt size. Pass `shared:true` to
 * opt into that explicitly.
 * @param {{apply:boolean, owned:Set<string>, roots?:string[], shared?:boolean, log:(s:string)=>void}} opts
 */
function unindexSkills(opts) {
  const owned = opts.owned;
  const log = opts.log || (() => {});
  const moves = [];
  const skippedForeign = [];
  const all = cb.defaultSkillRoots(CONFIG_DIR);
  const configRoot = path.join(CONFIG_DIR, "skills");
  const roots =
    opts.roots || (opts.shared ? all : all.filter((r) => r === configRoot));

  for (const root of roots) {
    const key = root.replace(process.env.HOME || "", "~").replace(/[^\w]+/g, "_");
    let ents = [];
    try {
      ents = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      const full = path.join(root, e.name);
      const isSkill = isLink(full) || (e.isDirectory() && fs.existsSync(path.join(full, "SKILL.md")));
      if (!isSkill) continue;
      if (cb.INDEXED_SKILLS.has(e.name)) continue; // stays indexed
      if (!owned.has(e.name)) {
        skippedForeign.push(e.name);
        continue; // never touch another vendor's / the user's skill
      }
      const dest = path.join(LAZY_DIR, "skills", key, e.name);
      moves.push({ from: full, to: dest, root: key, name: e.name });
      if (opts.apply) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.rmSync(dest, { recursive: true, force: true });
        if (isLink(full)) fs.unlinkSync(full);
        else fs.renameSync(full, dest);
        log(`unindexed ${e.name} -> ${dest.replace(process.env.HOME || "", "~")}`);
      }
    }
  }
  return { moves, skippedForeign: [...new Set(skippedForeign)] };
}

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  } catch {
    return { moves: [] };
  }
}

/** Restore skills moved by a previous --apply. */
function restoreSkills(log) {
  const man = readManifest();
  let restored = 0;
  for (const m of man.moves || []) {
    if (!fs.existsSync(m.to)) continue;
    if (fs.existsSync(m.from)) {
      log(`skip (target exists) ${m.from}`);
      continue;
    }
    fs.mkdirSync(path.dirname(m.from), { recursive: true });
    fs.renameSync(m.to, m.from);
    restored++;
    log(`restored ${m.name} -> ${m.from.replace(process.env.HOME || "", "~")}`);
  }
  return { restored, recorded: (man.moves || []).length };
}

/** Write the lazy catalog the conductor reads on demand. */
function writeCatalog(skills) {
  fs.mkdirSync(LAZY_DIR, { recursive: true });
  const rows = (skills || [])
    .filter((s) => !cb.INDEXED_SKILLS.has(s.name))
    .map((s) => ({ name: s.name, description: (s.description || "").slice(0, 220) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const doc = {
    version: 1,
    purpose:
      "Lazy skill catalog. These skills are NOT in the per-request system prompt index. Read one only when the task needs it.",
    howToUse:
      "Load on demand: read <config>/lazy/skills/<rootKey>/<name>/SKILL.md, or re-index by adding the name to INDEXED_SKILLS in scripts/lib/context-budget.js and re-running the diet.",
    count: rows.length,
    skills: rows,
  };
  fs.writeFileSync(SKILL_CATALOG, JSON.stringify(doc, null, 2) + "\n");
  return doc.count;
}

/**
 * Trim the description of ORCHESTRA-OWNED skills to a trigger-lean line.
 *
 * Offered as opt-in, never default: the description is what makes a host fire
 * the skill at the right moment, so shortening it trades trigger accuracy for
 * tokens. Measured on this host the whole owned set is 4,826 tok/request and a
 * 180-char cap recovers 1,838 of it — real but small next to the ~4,400 tok
 * coming from skills this repo does not own.
 *
 * Keeps the leading sentence intact (that is where the trigger verbs live) and
 * truncates on a word boundary so nothing becomes garbage.
 *
 * @param {{apply:boolean, maxChars?:number, owned:Set<string>, log:(s:string)=>void}} opts
 */
function trimOwnedSkillDescriptions(opts) {
  const max = Number.isFinite(opts.maxChars) ? opts.maxChars : 180;
  const log = opts.log || (() => {});
  const changed = [];
  let saved = 0;
  const seen = new Set();
  for (const root of cb.defaultSkillRoots(CONFIG_DIR)) {
    let ents = [];
    try {
      ents = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      const p = path.join(root, e.name, "SKILL.md");
      if (!fs.existsSync(p) || !opts.owned.has(e.name) || cb.INDEXED_SKILLS.has(e.name)) continue;
      if (seen.has(e.name)) continue;
      seen.add(e.name);
      const raw = fs.readFileSync(p, "utf8");
      const m = raw.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
      if (!m) continue;
      const fm = m[2];
      const dm = fm.match(/^description:[ \t]*(?:>-[ \t]*\r?\n((?:[ \t]+\S[^\r?\n]*\r?\n?)+)|(.*))$/m);
      if (!dm) continue;
      const folded = Boolean(dm[1]);
      const desc = (folded ? dm[1].split("\n").map((l) => l.trim()).join(" ") : (dm[2] || "").trim().replace(/^["']|["']$/g, "")).replace(/\s+/g, " ");
      if (desc.length <= max) continue;
      const cut = desc.slice(0, max);
      const trimmed = (cut.slice(0, Math.max(cut.lastIndexOf(" "), 40))).replace(/[,;:.]\s*$/, "") + ".";
      const before = cb.skillIndexRowTokens({ name: e.name, description: desc });
      const after = cb.skillIndexRowTokens({ name: e.name, description: trimmed });
      saved += before - after;
      changed.push({ file: p, from: desc.length, to: trimmed.length });
      if (opts.apply) {
        const newDesc = folded
          ? `description: >-\n  ${trimmed}`
          : `description: ${trimmed}`;
        fs.writeFileSync(p, raw.replace(dm[0], newDesc));
      }
    }
  }
  if (changed.length) log(`${opts.apply ? "trimmed" : "would trim"} ${changed.length} owned skill description(s), saving ~${saved} tok/request`);
  return { changed, saved, applied: opts.apply };
}

function report(log) {
  const before = cb.fullIndexReport({ configDir: CONFIG_DIR });
  const owned = bundleOwnedSkills();
  const audit = [];
  for (const root of cb.defaultSkillRoots(CONFIG_DIR)) {
    const a = cb.auditSkillDir(root);
    audit.push({
      root,
      total: a.rows.length,
      owned: a.rows.filter((r) => owned.has(r.name)).length,
      foreign: a.rows.filter((r) => !owned.has(r.name)).length,
      keep: a.rows.filter((r) => cb.INDEXED_SKILLS.has(r.name)).length,
    });
  }
  const removable = audit.reduce((s, a) => s + (a.owned - a.keep), 0);
  log("=== per-request index cost (live install) ===");
  log(`  agents visible : ${before.agents.entries} rows -> ${before.agents.tokens} tok`);
  log(`  skills indexed : ${before.skills.entries} rows -> ${before.skills.tokens} tok`);
  log(`  TOTAL          : ${before.totalTokens} tok/request (fixed, every call, every model)`);
  log("");
  log("=== skill roots (ownership-scoped) ===");
  for (const a of audit) {
    log(
      `  ${a.root.replace(process.env.HOME, "~").padEnd(32)} total=${a.total} owned=${a.owned} foreign=${a.foreign} keep-indexed=${a.keep}`
    );
  }
  const afterAgents = 0; // all subagents hidden => indexed rows ~= allowlist only
  log(`=== projected after diet ===`);
  log(`  agents index   : ~${afterAgents} tok (was ${before.agents.tokens})`);
  log(`  skills index   : owned removed; foreign rows stay (not ours to move)`);
  log(`  foreign skills : ${audit.reduce((s, a) => s + a.foreign, 0)} rows remain indexed`);
  return { before, owned, audit, removable };
}

function flagVal(argvName, dflt) {
  const i = process.argv.indexOf(argvName);
  if (i === -1) return null;
  const next = process.argv[i + 1];
  if (next === undefined || next.startsWith("--")) return dflt;
  const n = Number.parseInt(next, 10);
  return Number.isFinite(n) ? n : dflt;
}

function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const apply = has("--apply");
  const dry = has("--dry-run");
  const check = has("--check");
  const log = (s) => process.stdout.write(s + "\n");

  if (has("--restore")) {
    const r = restoreSkills(log);
    log(`restored ${r.restored}/${r.recorded} skills`);
    return;
  }

  if (has("--bundle")) {
    // Rewrite the bundle mirrors themselves so installs start already lean.
    const r = hideAgents({ apply: true, root: path.join(ROOT, "bundle", "opencode", "agents"), log });
    log(`bundle mirrors: hid=${r.needHiding} alreadyHidden=${r.alreadyHidden}`);
    return;
  }

  if (check) {
    const a = hideAgents({ apply: false });
    const owned = bundleOwnedSkills();
    const s = unindexSkills({ apply: false, owned });
    const bad = a.needHiding > 0 || s.moves.length > 0;
    if (bad) {
      log(
        `context diet drift: ${a.needHiding} agent(s) prompt-visible, ${s.moves.length} owned skill(s) indexed but unused`
      );
      log("fix: node scripts/orchestra-context-diet.js --apply");
      process.exit(1);
    }
    log("No drift. opencode skill root is allowlist-only and every subagent is hidden.");
    return;
  }

  const { before, owned } = report(log);
  const shared = has("--shared");
  const h = hideAgents({ apply, log });
  const s = unindexSkills({ apply, owned, shared, log });
  if (flagVal("--trim-descriptions", 180) !== null) {
    trimOwnedSkillDescriptions({ apply, maxChars: flagVal("--trim-descriptions", 180), owned, log });
  }
  const allSkillRows = [];
  for (const root of cb.defaultSkillRoots(CONFIG_DIR)) {
    allSkillRows.push(...cb.auditSkillDir(root).rows);
  }
  if (apply) {
    const n = writeCatalog(allSkillRows);
    writeAgentIndex({ apply: true, log });
    fs.mkdirSync(LAZY_DIR, { recursive: true });
    fs.writeFileSync(
      MANIFEST,
      JSON.stringify(
        { version: 1, appliedAt: new Date().toISOString(), moves: s.moves },
        null,
        2
      ) + "\n"
    );
    const after = cb.fullIndexReport({ configDir: CONFIG_DIR });
    log("");
    log(`APPLIED: hid ${h.needHiding} agents, pruned ${h.probes} probes, unindexed ${s.moves.length} skills, cataloged ${n}`);
    log(`index cost: ${before.totalTokens} -> ${after.totalTokens} tok/request (saved ${before.totalTokens - after.totalTokens})`);
    if (s.skippedForeign.length) {
      log(`left alone (not orchestra-owned, still indexed): ${s.skippedForeign.length} skills — their descriptions cost tokens; uninstall or trim them yourself, orchestra will not move another host's skills`);
    }
    if (!shared) {
      log(`shared roots (~/.agents/skills, ~/.claude/skills) left intact: Codex + Claude Code discover from there. Re-run with --shared to unindex them too.`);
    }
  } else if (dry) {
    log("");
    log(`DRY-RUN: would hide ${h.needHiding} agents, prune ${h.probes} probes, unindex ${s.moves.length} owned skills`);
    log(`would leave ${s.skippedForeign.length} foreign skills indexed (not ours to move)`);
  } else {
    log("");
    log(`ACTION: node scripts/orchestra-context-diet.js --apply   (idempotent; --restore to undo)`);
  }
}

if (require.main === module) main();

module.exports = {
  bundleOwnedSkills,
  hideAgents,
  unindexSkills,
  trimOwnedSkillDescriptions,
  withHidden,
  restoreSkills,
  writeCatalog,
  writeAgentIndex,
  report,
};
