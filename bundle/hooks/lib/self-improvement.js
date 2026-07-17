"use strict";

const { generateId } = require("./project-manager.js");
const { loadDailyState, saveDailyState } = require("./daily-planner.js");
const { loadMetricsState } = require("./observability.js");

function generateRetrospective(ps, { sprint, wentWell, toImprove, improvements }) {
  const retro = {
    id: generateId(),
    sprint: sprint || "unscheduled",
    date: new Date().toISOString(),
    wentWell: wentWell || [],
    toImprove: toImprove || [],
    improvements: improvements || [],
    actionItems: [],
    lessons: [],
    score: null,
  };

  ps.retrospectives.push(retro);
  const { saveProjectState } = require("./project-manager.js");
  saveProjectState(ps);
  return retro;
}

function addLesson(ps, retroId, lesson) {
  const retro = ps.retrospectives.find(r => r.id === retroId);
  if (!retro) return null;
  retro.lessons.push({
    text: lesson,
    timestamp: new Date().toISOString(),
  });
  const { saveProjectState } = require("./project-manager.js");
  saveProjectState(ps);
  return retro;
}

function addActionItem(ps, retroId, action) {
  const retro = ps.retrospectives.find(r => r.id === retroId);
  if (!retro) return null;
  const item = {
    text: action,
    status: "open",
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
  retro.actionItems.push(item);
  const { saveProjectState } = require("./project-manager.js");
  saveProjectState(ps);
  return retro;
}

function scoreRetrospective(ps, retroId, score) {
  const retro = ps.retrospectives.find(r => r.id === retroId);
  if (!retro) return null;
  retro.score = score;
  const { saveProjectState } = require("./project-manager.js");
  saveProjectState(ps);
  return retro;
}

function generateImprovementSuggestions(ps, state) {
  const suggestions = [];

  const gates = state.qualityGates;
  if (gates && gates.failed && gates.failed.length > 0) {
    suggestions.push({
      area: "quality",
      priority: "high",
      suggestion: `Resolve ${gates.failed.length} failed quality gates: ${gates.failed.map(g => g.id).join(", ")}`,
    });
  }

  const unresolvedDebt = ps.techDebt.filter(d => d.status === "unresolved");
  if (unresolvedDebt.length > 5) {
    suggestions.push({
      area: "technical-debt",
      priority: "medium",
      suggestion: `Address ${unresolvedDebt.length} unresolved technical debt items. Focus on high-severity items first.`,
    });
  }

  const highSeverityDebt = unresolvedDebt.filter(d => d.severity === "high" || d.severity === "critical");
  if (highSeverityDebt.length > 0) {
    suggestions.push({
      area: "technical-debt",
      priority: "high",
      suggestion: `${highSeverityDebt.length} high/critical severity debt items need immediate attention.`,
    });
  }

  const ds = loadDailyState();
  const recentEntries = ds.entries.slice(-7);
  const blockedCount = recentEntries.reduce((s, e) => s + e.blocked.length, 0);
  if (blockedCount > 5) {
    suggestions.push({
      area: "flow",
      priority: "medium",
      suggestion: `High blocked items count (${blockedCount} in last 7 days). Review blockers and process improvements.`,
    });
  }

  const ms = loadMetricsState();
  const violatedSLOs = ms.slos.filter(s => s.currentValue !== null && s.currentValue < s.target);
  if (violatedSLOs.length > 0) {
    suggestions.push({
      area: "reliability",
      priority: "high",
      suggestion: `${violatedSLOs.length} SLO${violatedSLOs.length > 1 ? "s" : ""} violated: ${violatedSLOs.map(s => s.name).join(", ")}.`,
    });
  }

  return suggestions;
}

function performArchitectureReview(state) {
  const reviews = [];
  if (state.iteration > 10) {
    reviews.push({
      type: "iteration",
      severity: "info",
      finding: `Orchestration has run ${state.iteration} iterations. Consider if the architecture supports the required complexity.`,
    });
  }
  return reviews;
}

function performDependencyReview(ps) {
  const reviews = [];
  const highDebt = ps.techDebt.filter(d => d.severity === "high" || d.severity === "critical");
  if (highDebt.length > 3) {
    reviews.push({
      type: "tech-debt",
      severity: "warning",
      finding: `${highDebt.length} high/critical debt items suggest architectural or dependency issues.`,
    });
  }
  return reviews;
}

function generateContinuousImprovementPlan(ps, state) {
  const suggestions = generateImprovementSuggestions(ps, state);
  const archReviews = performArchitectureReview(state);
  const depReviews = performDependencyReview(ps);
  const all = [...suggestions, ...archReviews.map(r => ({ area: "architecture", priority: r.severity, suggestion: r.finding })), ...depReviews.map(r => ({ area: "dependencies", priority: r.severity, suggestion: r.finding }))];
  return all;
}

module.exports = {
  generateRetrospective,
  addLesson,
  addActionItem,
  scoreRetrospective,
  generateImprovementSuggestions,
  performArchitectureReview,
  performDependencyReview,
  generateContinuousImprovementPlan,
};
