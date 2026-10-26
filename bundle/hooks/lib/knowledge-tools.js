"use strict";

/**
 * Knowledge tools for the MCP server (local stdio hosts + remote ChatGPT).
 *
 * Read side: allowlisted project docs (docs/**, context/*.md, top-level md),
 * and hybrid memory recall. Write side: a knowledge INBOX only — shared
 * entries are appended to state/knowledge-inbox.json and stay `pending`
 * until a human or an orchestra phase applies them. The server never edits
 * context/docs directly, because a remote connector is untrusted input.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { readJsonSafe, writeJson, resolveStateDir } = require("./safe-write.js");
const { searchMemoryIndex } = require("./memory-index.js");

const ROOT = () => process.env.PCORE_MCP_ROOT || process.cwd();
const MAX_FILE_BYTES = 200 * 1024;
const MAX_RESULTS = 20;
const SNIPPET_CHARS = 240;

// Never serve these, even inside an allowed directory.
const SECRET_RE = /(\.env|secret|credential|token|private[-_]key|\.pem|id_rsa)/i;

/** Directories/files the read tools may touch, relative to the project root. */
function isAllowedRel(rel) {
  const norm = rel.split(path.sep).join("/");
  if (SECRET_RE.test(norm)) return false;
  if (/^(docs|context)\//.test(norm) && norm.endsWith(".md")) return true;
  if (/^AGENTS\.md$|^README\.md$|^CONTRIBUTING\.md$|^SECURITY\.md$|^ORCHESTRA\.md$/.test(norm)) return true;
  return false;
}

/** Resolve a requested relpath strictly inside ROOT() and on the allowlist. */
function resolveAllowed(rel) {
  if (typeof rel !== "string" || !rel) return null;
  const root = ROOT();
  const abs = path.resolve(root, rel);
  const inside = abs === root || abs.startsWith(root + path.sep);
  if (!inside) return null;
  if (!isAllowedRel(path.relative(root, abs))) return null;
  return abs;
}

function walkMd(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if ([".git", "node_modules", "plans", "audit"].includes(e.name)) continue;
      walkMd(full, out);
    } else if (e.name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

function candidateFiles() {
  const root = ROOT();
  const files = [];
  for (const dir of ["docs", "context"]) {
    for (const f of walkMd(path.join(root, dir))) {
      const rel = path.relative(root, f);
      if (isAllowedRel(rel)) files.push(rel);
    }
  }
  for (const f of ["AGENTS.md", "README.md", "CONTRIBUTING.md", "SECURITY.md", "ORCHESTRA.md"]) {
    if (fs.existsSync(path.join(root, f)) && isAllowedRel(f)) files.push(f);
  }
  return files;
}

function searchDocs({ query, limit = MAX_RESULTS } = {}) {
  if (!query || typeof query !== "string") throw new Error("query required");
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const cap = Math.max(1, Math.min(Number(limit) || MAX_RESULTS, MAX_RESULTS));
  const matches = [];
  for (const rel of candidateFiles()) {
    if (matches.length >= cap) break;
    const abs = path.resolve(ROOT(), rel);
    let text;
    try {
      if (fs.statSync(abs).size > MAX_FILE_BYTES) continue;
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const low = lines[i].toLowerCase();
      const hits = terms.filter((t) => low.includes(t)).length;
      if (hits === terms.length) {
        matches.push({ file: rel, line: i + 1, snippet: lines[i].trim().slice(0, SNIPPET_CHARS) });
        break;
      }
    }
  }
  return { root: ROOT(), query, filesScanned: candidateFiles().length, matches };
}

function readDoc({ file } = {}) {
  const abs = resolveAllowed(file);
  if (!abs) throw new Error("file not allowed: must be a docs/, context/, or top-level project markdown file");
  if (!fs.existsSync(abs)) throw new Error("not found: " + file);
  if (fs.statSync(abs).size > MAX_FILE_BYTES) throw new Error("file too large (200 KB cap): " + file);
  return { file: path.relative(ROOT(), abs), content: fs.readFileSync(abs, "utf8") };
}

function readContext({ file } = {}) {
  const abs = resolveAllowed(path.join("context", String(file || "")));
  if (!abs || !fs.existsSync(abs)) {
    const available = [];
    const dir = path.join(ROOT(), "context");
    try {
      for (const f of fs.readdirSync(dir)) if (f.endsWith(".md")) available.push(f);
    } catch {}
    throw new Error("context file not available — tried: context/" + file + "; available: " + available.join(", "));
  }
  return { file: path.relative(ROOT(), abs), content: fs.readFileSync(abs, "utf8") };
}

function searchMemory({ query, topK = 5 } = {}) {
  if (!query || typeof query !== "string") throw new Error("query required");
  try {
    const hits = searchMemoryIndex(query, Math.max(1, Math.min(Number(topK) || 5, 10)));
    return { query, hits };
  } catch (e) {
    return { query, hits: [], error: e.message };
  }
}

const INBOX_FILE = "knowledge-inbox.json";

function inboxPath() {
  const base = resolveStateDir(path.join(os.homedir(), ".pcore", "state"));
  return path.join(base, INBOX_FILE);
}

function shareKnowledge({ title, body, tags, source } = {}) {
  if (!title || !body) throw new Error("title and body required");
  const inbox = readJsonSafe(inboxPath(), { entries: [] }) || { entries: [] };
  if (!Array.isArray(inbox.entries)) inbox.entries = [];
  const entry = {
    id: "kb-" + Date.now().toString(36),
    ts: new Date().toISOString(),
    title: String(title).slice(0, 200),
    body: String(body).slice(0, 8000),
    tags: Array.isArray(tags) ? tags.map(String).slice(0, 10) : [],
    source: String(source || "mcp-client").slice(0, 80),
    status: "pending",
  };
  inbox.entries.push(entry);
  writeJson(inboxPath(), inbox);
  return { id: entry.id, status: entry.status, inbox: inboxPath() };
}

function listKnowledge({ status } = {}) {
  const inbox = readJsonSafe(inboxPath(), { entries: [] }) || { entries: [] };
  const entries = Array.isArray(inbox.entries) ? inbox.entries : [];
  return {
    inbox: inboxPath(),
    entries: (status ? entries.filter((e) => e.status === status) : entries).slice(-50),
  };
}

/** MCP tool definitions (JSON Schema input). */
const TOOL_DEFINITIONS = [
  {
    name: "search_docs",
    description: "Full-text search over the project's docs/, context/ and top-level markdown (read-only allowlist)",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "space-separated terms; all must appear on one line" },
        limit: { type: "number", description: "max matches (default 20)" },
      },
      required: ["query"],
    },
    handler: searchDocs,
  },
  {
    name: "read_doc",
    description: "Read one allowlisted markdown file by project-relative path",
    inputSchema: {
      type: "object",
      properties: { file: { type: "string", description: "e.g. docs/02-FEATURES-HOOKS-COMPONENTS-AGENTS.md" } },
      required: ["file"],
    },
    handler: readDoc,
  },
  {
    name: "read_context",
    description: "Read one onboarding context file (context/<name>.md)",
    inputSchema: {
      type: "object",
      properties: { file: { type: "string", description: "e.g. architecture.md" } },
      required: ["file"],
    },
    handler: readContext,
  },
  {
    name: "search_memory",
    description: "Recall completed goals/decisions from the orchestra hybrid memory index",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        topK: { type: "number", description: "default 5, max 10" },
      },
      required: ["query"],
    },
    handler: searchMemory,
  },
  {
    name: "share_knowledge",
    description:
      "Append a knowledge item to the project inbox for review. Never edits docs/context directly.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        source: { type: "string", description: "caller label, e.g. chatgpt" },
      },
      required: ["title", "body"],
    },
    handler: shareKnowledge,
  },
  {
    name: "list_knowledge",
    description: "List inbox entries (optionally filter status=pending|applied|rejected)",
    inputSchema: {
      type: "object",
      properties: { status: { type: "string" } },
    },
    handler: listKnowledge,
  },
];

module.exports = {
  TOOL_DEFINITIONS,
  searchDocs,
  readDoc,
  readContext,
  searchMemory,
  shareKnowledge,
  listKnowledge,
  inboxPath,
  isAllowedRel,
  resolveAllowed,
  ROOT,
};
