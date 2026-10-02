"use strict";

const path = require("node:path");
const { tokenize } = require("./semantic-memory.js");
const { writeJson, readJsonSafe, resolveStatePath } = require("./safe-write.js");

const INDEX_PATH = path.join(__dirname, "..", "state", "memory-index.json");
const INDEX_MAX_ENTRIES = 500;

function loadMemoryIndex() {
  return readJsonSafe(resolveStatePath(INDEX_PATH), { version: 1, entries: [], inverted: {} });
}

function saveMemoryIndex(index) {
  if (index.entries.length > INDEX_MAX_ENTRIES) {
    const drop = index.entries.length - INDEX_MAX_ENTRIES;
    const removed = index.entries.splice(0, drop);
    for (const id of removed.map((e) => e.id)) {
      for (const tokens of Object.values(index.inverted)) {
        const i = tokens.indexOf(id);
        if (i >= 0) tokens.splice(i, 1);
      }
    }
  }
  writeJson(resolveStatePath(INDEX_PATH), index);
}

function indexCompletedGoal(goalEntry, timestamp) {
  const index = loadMemoryIndex();
  const id = `g-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
  const text = [goalEntry.goal, ...(goalEntry.lessons || [])].join(" ");
  const tokens = tokenize(text);

  index.entries.push({
    id,
    goal: goalEntry.goal,
    outcome: goalEntry.outcome,
    timestamp,
    token_count: tokens.length,
  });

  for (const t of tokens) {
    if (!index.inverted[t]) index.inverted[t] = [];
    if (!index.inverted[t].includes(id)) index.inverted[t].push(id);
  }

  saveMemoryIndex(index);
  return id;
}

function searchMemoryIndex(query, topK = 5) {
  const index = loadMemoryIndex();
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];

  const scores = new Map();
  for (const t of qTokens) {
    for (const id of index.inverted[t] || []) {
      scores.set(id, (scores.get(id) || 0) + 1);
    }
  }

  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK);

  const byId = new Map(index.entries.map((e) => [e.id, e]));
  return ranked.map(([id, score]) => ({ ...byId.get(id), score }));
}

module.exports = {
  INDEX_PATH,
  loadMemoryIndex,
  indexCompletedGoal,
  searchMemoryIndex,
};
