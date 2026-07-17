"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { MAX_DAILY_ENTRIES } = require("./constants.js");
const { loadProjectState } = require("./project-manager.js");

const DAILY_PATH = path.join(__dirname, "..", "state", "orchestra-daily.json");

const DEFAULT_DAILY_STATE = {
  version: 1,
  entries: [],
  currentSprint: null,
  sprintStart: null,
  sprintEnd: null,
};

function loadDailyState() {
  try {
    if (!fs.existsSync(DAILY_PATH)) return { ...DEFAULT_DAILY_STATE, entries: [] };
    const raw = JSON.parse(fs.readFileSync(DAILY_PATH, "utf8"));
    return { ...DEFAULT_DAILY_STATE, ...raw, entries: raw.entries || [] };
  } catch {
    return { ...DEFAULT_DAILY_STATE, entries: [] };
  }
}

function saveDailyState(ds) {
  fs.mkdirSync(path.dirname(DAILY_PATH), { recursive: true });
  if (ds.entries.length > MAX_DAILY_ENTRIES) {
    ds.entries = ds.entries.slice(-MAX_DAILY_ENTRIES);
  }
  fs.writeFileSync(DAILY_PATH, JSON.stringify(ds, null, 2));
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getOrCreateTodayEntry(ds) {
  const key = getTodayKey();
  let entry = ds.entries.find(e => e.date === key);
  if (!entry) {
    entry = {
      date: key,
      goals: [],
      completed: [],
      blocked: [],
      remaining: [],
      priorities: [],
      riskReport: "",
      codeQualityReport: "",
      techDebtReport: "",
      testCoverageReport: "",
      deploymentStatus: "",
      suggestedImprovements: [],
      nextActions: [],
      dailyJournal: "",
      summary: "",
      metrics: {
        tasksCompleted: 0,
        bugsFixed: 0,
        featuresDelivered: 0,
        hoursLogged: 0,
        codeChanges: 0,
        testsWritten: 0,
      },
    };
    ds.entries.push(entry);
  }
  return entry;
}

function addDailyGoal(ds, goal) {
  const entry = getOrCreateTodayEntry(ds);
  entry.goals.push({ text: goal, status: "pending", createdAt: new Date().toISOString() });
  saveDailyState(ds);
  return entry;
}

function completeDailyGoal(ds, goalText) {
  const entry = getOrCreateTodayEntry(ds);
  const goal = entry.goals.find(g => g.text === goalText);
  if (goal) {
    goal.status = "completed";
    goal.completedAt = new Date().toISOString();
    entry.completed.push(goalText);
  }
  saveDailyState(ds);
  return entry;
}

function addBlockedItem(ds, item) {
  const entry = getOrCreateTodayEntry(ds);
  entry.blocked.push({ text: item, createdAt: new Date().toISOString() });
  saveDailyState(ds);
  return entry;
}

function recordDailyMetrics(ds, metricsUpdate) {
  const entry = getOrCreateTodayEntry(ds);
  Object.assign(entry.metrics, metricsUpdate);
  saveDailyState(ds);
  return entry;
}

function writeDailyJournal(ds, journalText) {
  const entry = getOrCreateTodayEntry(ds);
  entry.dailyJournal = journalText;
  saveDailyState(ds);
  return entry;
}

function generateDailySummary(ds) {
  const entry = getOrCreateTodayEntry(ds);
  const ps = loadProjectState();
  const completedTasks = ps.tasks.filter(t => t.status === "completed" || t.status === "done");
  const pendingTasks = ps.tasks.filter(t => t.status === "backlog" || t.status === "in-progress");
  const unresolvedDebt = ps.techDebt.filter(d => d.status === "unresolved");

  const summary = {
    date: entry.date,
    goalsToday: entry.goals.length,
    completedToday: entry.completed.length,
    blockedToday: entry.blocked.length,
    totalTasks: ps.tasks.length,
    completedTasks: completedTasks.length,
    pendingTasks: pendingTasks.length,
    completionPercent: ps.tasks.length > 0
      ? Math.round((completedTasks.length / ps.tasks.length) * 100) : 0,
    unresolvedTechDebt: unresolvedDebt.length,
    totalTechDebt: ps.techDebt.length,
    velocity: ps.velocity.averageVelocity,
    epicCount: ps.epics.length,
    milestoneCount: ps.milestones.length,
    storyCount: ps.stories.length,
    metrics: entry.metrics,
    blocked: entry.blocked,
    priorities: entry.priorities,
    nextActions: entry.nextActions,
  };

  entry.summary = JSON.stringify(summary);
  saveDailyState(ds);
  return summary;
}

function generateWeeklySummary(ds) {
  const entries = ds.entries;
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekKey = weekAgo.toISOString().slice(0, 10);

  const weekEntries = entries.filter(e => e.date >= weekKey);
  const totalCompleted = weekEntries.reduce((s, e) => s + e.completed.length, 0);
  const totalBlocked = weekEntries.reduce((s, e) => s + e.blocked.length, 0);
  const totalGoals = weekEntries.reduce((s, e) => s + e.goals.length, 0);

  return {
    period: `${weekKey} to ${getTodayKey()}`,
    daysTracked: weekEntries.length,
    totalGoals,
    totalCompleted,
    totalBlocked,
    completionRate: totalGoals > 0 ? Math.round((totalCompleted / totalGoals) * 100) : 0,
    entries: weekEntries.map(e => ({
      date: e.date, goals: e.goals.length, completed: e.completed.length,
      metrics: e.metrics,
    })),
  };
}

function generateDailyEngineeringJournal(ds) {
  const entry = getOrCreateTodayEntry(ds);
  const today = getTodayKey();
  let journal = `# Engineering Journal — ${today}\n\n`;

  journal += `## Today's Goals\n`;
  for (const g of entry.goals) {
    journal += `- [${g.status === "completed" ? "x" : " "}] ${g.text}\n`;
  }

  if (entry.completed.length > 0) {
    journal += `\n## Completed\n`;
    for (const c of entry.completed) journal += `- ${c}\n`;
  }

  if (entry.blocked.length > 0) {
    journal += `\n## Blocked\n`;
    for (const b of entry.blocked) journal += `- ${b.text}\n`;
  }

  journal += `\n## Metrics\n`;
  for (const [k, v] of Object.entries(entry.metrics)) {
    journal += `- ${k}: ${v}\n`;
  }

  if (entry.dailyJournal) {
    journal += `\n## Notes\n${entry.dailyJournal}\n`;
  }

  if (entry.nextActions.length > 0) {
    journal += `\n## Next Actions\n`;
    for (const a of entry.nextActions) journal += `- ${a}\n`;
  }
  return journal;
}

function startSprint(ds, sprintName, durationDays) {
  ds.currentSprint = sprintName;
  ds.sprintStart = new Date().toISOString();
  const end = new Date();
  end.setDate(end.getDate() + (durationDays || 14));
  ds.sprintEnd = end.toISOString();
  saveDailyState(ds);
  return { sprint: sprintName, start: ds.sprintStart, end: ds.sprintEnd };
}

module.exports = {
  DAILY_PATH,
  DEFAULT_DAILY_STATE,
  loadDailyState,
  saveDailyState,
  getTodayKey,
  getOrCreateTodayEntry,
  addDailyGoal,
  completeDailyGoal,
  addBlockedItem,
  recordDailyMetrics,
  writeDailyJournal,
  generateDailySummary,
  generateWeeklySummary,
  generateDailyEngineeringJournal,
  startSprint,
};
