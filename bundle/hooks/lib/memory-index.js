"use strict";

const path = require("node:path");
const { tokenize } = require("./semantic-memory.js");
const { writeJson, readJsonSafe, resolveStatePath } = require("./safe-write.js");
const fts = require("./memory-fts.js");

const INDEX_PATH = path.join(__dirname, "..", "state", "memory-index.json");
const INDEX_MAX_ENTRIES = 500;
const RRF_K = 60;
const LESSON_MAX_COUNT = 3;
const LESSON_MAX_CHARS = 200;

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
    fts.removeFts(removed.map((e) => e.id));
  }
  writeJson(resolveStatePath(INDEX_PATH), index);
}

function indexCompletedGoal(goalEntry, timestamp) {
  const index = loadMemoryIndex();
  const id = `g-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
  const lessons = (goalEntry.lessons || [])
    .filter((l) => typeof l === "string" && l.trim())
    .slice(0, LESSON_MAX_COUNT)
    .map((l) => l.slice(0, LESSON_MAX_CHARS));
  const text = [goalEntry.goal, ...lessons].join(" ");
  const tokens = tokenize(text);

  index.entries.push({
    id,
    goal: goalEntry.goal,
    outcome: goalEntry.outcome,
    duration_ms: goalEntry.duration_ms ?? null,
    phase_count: goalEntry.phase_count ?? null,
    run_id: goalEntry.run_id || null,
    plan_artifact: goalEntry.plan_artifact || null,
    lessons,
    timestamp,
    token_count: tokens.length,
  });

  for (const t of tokens) {
    if (!index.inverted[t]) index.inverted[t] = [];
    if (!index.inverted[t].includes(id)) index.inverted[t].push(id);
  }

  saveMemoryIndex(index);
  fts.indexGoalFts(id, goalEntry, timestamp);
  return id;
}

function searchMemoryIndex(query, topK = 5) {
  const index = loadMemoryIndex();
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];

  // IDF-weighted lexical ranking: rare query tokens discriminate far better
  // than tokens that appear in most indexed goals.
  const totalDocs = index.entries.length;
  const scores = new Map();
  for (const t of new Set(qTokens)) {
    const ids = index.inverted[t] || [];
    if (ids.length === 0) continue;
    const idf = 1 + Math.log(totalDocs / Math.max(1, ids.length));
    for (const id of ids) {
      scores.set(id, (scores.get(id) || 0) + idf);
    }
  }

  const jsonRanked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([id]) => id);
  const ftsRanked = fts
    .searchFts(query, Math.max(topK * 3, 15))
    .map((row) => row.entryId);

  const byId = new Map(index.entries.map((e) => [e.id, e]));
  const fused = new Map();
  const addRank = (ranked, source) => {
    ranked.forEach((id, i) => {
      if (!byId.has(id)) return;
      const row = fused.get(id) || { rrf: 0, sources: new Set() };
      row.rrf += 1 / (RRF_K + i + 1);
      row.sources.add(source);
      fused.set(id, row);
    });
  };
  addRank(jsonRanked, "json");
  addRank(ftsRanked, "fts");

  return [...fused.entries()]
    .sort((a, b) => b[1].rrf - a[1].rrf || String(byId.get(b[0]).timestamp).localeCompare(String(byId.get(a[0]).timestamp)))
    .slice(0, topK)
    .map(([id, row]) => ({
      ...byId.get(id),
      score: Math.round(row.rrf * 10000) / 10000,
      sources: [...row.sources],
    }));
}

module.exports = {
  INDEX_PATH,
  loadMemoryIndex,
  indexCompletedGoal,
  searchMemoryIndex,
};
