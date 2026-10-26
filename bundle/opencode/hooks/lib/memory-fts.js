"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { tokenize } = require("./semantic-memory.js");
const { resolveStatePath } = require("./safe-write.js");

const DB_PATH = path.join(__dirname, "..", "state", "memory-fts.db");

let handle = null;
let opened = false;

function ftsDisabled() {
  return process.env.PCORE_FTS_DISABLE === "1";
}

function openDb() {
  if (opened) return handle;
  opened = true;
  if (ftsDisabled()) return null;
  try {
    const target = resolveStatePath(DB_PATH);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const { DatabaseSync } = require("node:sqlite");
    handle = new DatabaseSync(target);
    handle
      .prepare(
        "CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(" +
          "entry_id UNINDEXED, goal, lessons, timestamp UNINDEXED)"
      )
      .run();
  } catch {
    handle = null;
  }
  return handle;
}

function ftsAvailable() {
  return openDb() !== null;
}

function indexGoalFts(entryId, goalEntry, timestamp) {
  const db = openDb();
  if (!db) return false;
  try {
    const lessons = (goalEntry.lessons || []).join(" ");
    db.prepare("INSERT INTO memory_fts (entry_id, goal, lessons, timestamp) VALUES (?, ?, ?, ?)").run(
      entryId,
      goalEntry.goal || "",
      lessons,
      timestamp || ""
    );
    return true;
  } catch {
    return false;
  }
}

function matchExpression(query) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `"${t.replaceAll('"', '""')}"`).join(" OR ");
}

function searchFts(query, topK = 5) {
  const db = openDb();
  if (!db) return [];
  const expr = matchExpression(query);
  if (!expr) return [];
  try {
    const rows = db
      .prepare(
        "SELECT entry_id, -bm25(memory_fts) AS score FROM memory_fts WHERE memory_fts MATCH ? ORDER BY score DESC LIMIT ?"
      )
      .all(expr, Math.max(1, topK));
    return rows
      .filter((r) => r.entry_id)
      .map((r) => ({ entryId: r.entry_id, score: Math.max(0, Number(r.score) || 0) }));
  } catch {
    return [];
  }
}

function removeFts(entryIds) {
  const db = openDb();
  if (!db || !entryIds || entryIds.length === 0) return db !== null;
  try {
    const del = db.prepare("DELETE FROM memory_fts WHERE entry_id = ?");
    for (const id of entryIds) del.run(id);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  DB_PATH,
  ftsAvailable,
  indexGoalFts,
  searchFts,
  removeFts,
};
