"use strict";

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "this", "that", "into", "when", "what",
  "how", "are", "was", "were", "has", "have", "had", "not", "but", "can", "will",
  "all", "next", "fix", "add", "use", "using", "via", "our", "your",
]);

const DEFAULT_TOP_K = 3;

function tokenize(text) {
  if (!text || typeof text !== "string") return [];
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

function uniqueTokens(texts) {
  const set = new Set();
  for (const text of texts) {
    for (const t of tokenize(text)) set.add(t);
  }
  return set;
}

/**
 * BM25-lite relevance: token overlap + recency boost (no embeddings required).
 * Upgrade path: optional hybrid with local embeddings in orchestra-memory.json.
 */
function scoreEntry(entry, queryTokens, index, total) {
  if (queryTokens.length === 0) return 0;

  const corpus = uniqueTokens([
    entry.goal || "",
    ...(entry.lessons || []),
    entry.outcome || "",
  ]);

  let overlap = 0;
  for (const t of queryTokens) {
    if (corpus.has(t)) overlap++;
  }
  if (overlap === 0) return 0;

  const recencyBoost = total > 1 ? (index / (total - 1)) * 2 : 1;
  const outcomeBoost = entry.outcome === "completed" ? 1 : 0;
  return overlap * 10 + recencyBoost + outcomeBoost;
}

function retrieveRelevantGoals(completedGoals, query, topK = DEFAULT_TOP_K) {
  if (!completedGoals?.length || !query?.trim()) return [];

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const scored = completedGoals
    .map((entry, index) => ({
      entry,
      score: scoreEntry(entry, queryTokens, index, completedGoals.length),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored.map((row) => row.entry);
}

function retrieveRelevantErrors(errorPatterns, query, topK = 2) {
  if (!errorPatterns?.length || !query?.trim()) return [];

  const queryTokens = tokenize(query);
  const scored = errorPatterns
    .map((entry) => ({
      entry,
      score: scoreEntry(
        { goal: entry.error_type, lessons: entry.solution ? [entry.solution] : [] },
        queryTokens,
        0,
        1
      ),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored.map((row) => row.entry);
}

function formatRelevantGoals(goals) {
  if (!goals.length) return "";
  const lines = ["Relevant past goals (semantic recall):"];
  for (const g of goals) {
    const lessons =
      g.lessons?.length > 0 ? ` | lessons: ${g.lessons.slice(0, 2).join("; ")}` : "";
    lines.push(
      `  - "${g.goal}" (${g.outcome}, ${Math.round((g.duration_ms || 0) / 1000)}s)${lessons}`
    );
  }
  return lines.join("\n");
}

module.exports = {
  tokenize,
  retrieveRelevantGoals,
  retrieveRelevantErrors,
  formatRelevantGoals,
  DEFAULT_TOP_K,
};
