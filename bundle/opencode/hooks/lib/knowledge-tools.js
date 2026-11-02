"use strict";

/**
 * Knowledge tools for the MCP server (local stdio hosts + remote ChatGPT).
 *
 * Read side: allowlisted project docs (docs/**, context/*.md, top-level md),
 * and hybrid memory recall. Write side: a knowledge store — SQLite at
 * `state/knowledge.db` (JSON inbox fallback on Node without `node:sqlite`) —
 * where shared entries land as `pending` and only move to `approved`/`rejected`
 * through `review_knowledge`. The server never edits docs/context directly,
 * because a remote connector is untrusted input: it records status, and a human
 * or an orchestra phase reads approved rows back and edits the files.
 */

const fs = require("node:fs");
const path = require("node:path");
const { searchMemoryIndex } = require("./memory-index.js");
const store = require("./knowledge-store.js");

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

function inboxPath() {
  return store.dbAvailable() ? store.dbPath() : path.join(path.dirname(store.dbPath()), "knowledge-inbox.json");
}

function shareKnowledge({ title, body, tags, source } = {}) {
  if (!title || !body) throw new Error("title and body required");
  const entry = store.insertKnowledge({ title, body, tags, source, status: "pending" });
  return { id: entry.id, status: entry.status, store: entry.store, inbox: inboxPath() };
}

function listKnowledge({ status } = {}) {
  return {
    inbox: inboxPath(),
    entries: store.queryKnowledge({ status, limit: 50 }),
  };
}

/**
 * Move a knowledge entry out of `pending`. The human-review gate: an
 * authorized connector (behind PCORE_MCP_TOKEN) marks reviewed knowledge so a
 * local CLI/orchestra phase pulls `approved` rows back — but the server never
 * writes those rows into docs/context itself.
 */
function reviewKnowledge({ id: entryId, status } = {}) {
  if (!entryId || !status) throw new Error("id and status required");
  const allowed = ["pending", "approved", "rejected", "applied"];
  if (!allowed.includes(status)) throw new Error("status must be one of: " + allowed.join(", "));
  const updated = store.setKnowledgeStatus(entryId, status);
  if (!updated) throw new Error("knowledge entry not found (or store unavailable): " + entryId);
  return { id: updated.id, status: updated.status, inbox: inboxPath() };
}

/**
 * Chat-thread + pairing handlers — the "continue this conversation from the
 * CLI" half of the hub. Every write is partitioned to the current project slug
 * inside the store; nothing here touches docs/context.
 */
function startThread({ title, externalKind, externalId } = {}) {
  const thread = store.createThread({ title: title || "", externalKind, externalId });
  if (!thread) throw new Error("chat store unavailable (requires node:sqlite)");
  return thread;
}

function postMessage({ threadId, role, content, author } = {}) {
  if (!threadId || !content) throw new Error("threadId and content required");
  const msg = store.addMessage({ threadId, role, content, author });
  if (!msg) throw new Error("thread not found or store unavailable: " + threadId);
  return msg;
}

function getThread({ threadId, externalKind, externalId, messageLimit } = {}) {
  let id = threadId;
  if (!id && externalKind && externalId) {
    const pair = store.getPair({ externalKind, externalId });
    if (pair) id = pair.thread_id;
  }
  if (!id) throw new Error("threadId (or externalKind + externalId) required");
  const thread = store.getThread(id, { messageLimit });
  if (!thread) throw new Error("thread not found: " + id);
  return thread;
}

function listThreads({ status, limit } = {}) {
  return { project: store.projectKey(), threads: store.listThreads({ status, limit }) };
}

function pairThread({ externalKind, externalId, threadId } = {}) {
  if (!externalId || !threadId) throw new Error("externalId and threadId required");
  const pair = store.upsertPair({ externalKind, externalId, threadId });
  if (!pair) throw new Error("pairing store unavailable (requires node:sqlite)");
  return pair;
}

function listPairs() {
  return { project: store.projectKey(), pairs: store.listPairs() };
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
      "Append a knowledge item to the project store as `pending`. Never edits docs/context directly.",
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
    description: "List knowledge entries (optionally filter status=pending|approved|rejected|applied)",
    inputSchema: {
      type: "object",
      properties: { status: { type: "string" } },
    },
    handler: listKnowledge,
  },
  {
    name: "review_knowledge",
    description: "Promote/demote a knowledge entry out of pending (approved|rejected|applied|pending).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "knowledge entry id" },
        status: { type: "string", enum: ["pending", "approved", "rejected", "applied"] },
      },
      required: ["id", "status"],
    },
    handler: reviewKnowledge,
  },
  {
    name: "start_thread",
    description: "Open a chat thread for this project; optionally bind it to an external conversation id.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        externalKind: { type: "string", description: "connector label, e.g. chatgpt|gemini|cursor" },
        externalId: { type: "string", description: "the connector's conversation id" },
      },
    },
    handler: startThread,
  },
  {
    name: "post_message",
    description: "Append a message to a chat thread (role=assistant|user|system).",
    inputSchema: {
      type: "object",
      properties: {
        threadId: { type: "string" },
        role: { type: "string" },
        content: { type: "string" },
        author: { type: "string" },
      },
      required: ["threadId", "content"],
    },
    handler: postMessage,
  },
  {
    name: "get_thread",
    description: "Resume a chat thread by id or by external binding; returns ordered messages.",
    inputSchema: {
      type: "object",
      properties: {
        threadId: { type: "string" },
        externalKind: { type: "string" },
        externalId: { type: "string" },
        messageLimit: { type: "number", description: "default 100, max 500" },
      },
    },
    handler: getThread,
  },
  {
    name: "list_threads",
    description: "List this project's chat threads (optionally filter status=open|closed).",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string" },
        limit: { type: "number", description: "default 50, max 200" },
      },
    },
    handler: listThreads,
  },
  {
    name: "pair_thread",
    description: "Bind an external conversation id to a thread so either side can resume by that id.",
    inputSchema: {
      type: "object",
      properties: {
        externalKind: { type: "string", description: "connector label, e.g. chatgpt|gemini" },
        externalId: { type: "string" },
        threadId: { type: "string" },
      },
      required: ["externalId", "threadId"],
    },
    handler: pairThread,
  },
  {
    name: "list_pairs",
    description: "List this project's external-conversation-to-thread bindings.",
    inputSchema: { type: "object", properties: {} },
    handler: listPairs,
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
  reviewKnowledge,
  startThread,
  postMessage,
  getThread,
  listThreads,
  pairThread,
  listPairs,
  inboxPath,
  isAllowedRel,
  resolveAllowed,
  ROOT,
};
