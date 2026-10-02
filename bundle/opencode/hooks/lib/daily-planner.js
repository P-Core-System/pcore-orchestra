"use strict";

const path = require("node:path");
const { MAX_DAILY_ENTRIES } = require("./constants.js");
const { loadProjectState } = require("./project-manager.js");
const { writeJson, readJsonSafe, resolveStatePath, atomicWrite } = require("./safe-write.js");

const DAILY_PATH = path.join(__dirname, "..", "state", "orchestra-daily.json");

const DEFAULT_SESSION_DAILY = {
  entries: [],
  currentSprint: null,
  sprintStart: null,
  sprintEnd: null,
};

const DEFAULT_DAILY_STATE = {
  version: 1,
  sessions: {},
};

/** Get the session ID from environment variables. */
function getSessionId() {
  return (
    process.env.PCORE_SESSION_ID ||
    process.env.OPENCODE_SESSION_ID ||
    process.env.CLAUDE_SESSION_ID ||
    process.env.CURSOR_TRACE_ID ||
    "pid-" + process.pid
  );
}

/** Migrate legacy flat daily state to session-namespaced structure. */
function migrateToSessions(raw) {
  if (raw && raw.sessions && typeof raw.sessions === "object") {
    return raw;
  }

  const sessionId = getSessionId();
  const migrated = {
    version: 1,
    sessions: {},
  };
  migrated.sessions[sessionId] = { ...DEFAULT_SESSION_DAILY, ...(raw || {}), entries: (raw?.entries || []) };
  return migrated;
}

function loadDailyState(sessionId) {
  const session = sessionId || getSessionId();
  try {
    const raw = readJsonSafe(resolveStatePath(DAILY_PATH), { version: 1, sessions: {} });
    const migrated = migrateToSessions(raw);
    if (!migrated.sessions[session]) {
      migrated.sessions[session] = { ...DEFAULT_SESSION_DAILY };
    }
    return migrated;
  } catch {
    const fresh = { version: 1, sessions: {} };
    fresh.sessions[session] = { ...DEFAULT_SESSION_DAILY };
    return fresh;
  }
}

function saveDailyState(ds, sessionId) {
  const session = sessionId || getSessionId();
  const dailyPath = resolveStatePath(DAILY_PATH);
  const fullState = migrateToSessions(readJsonSafe(dailyPath, { version: 1, sessions: {} }));

  if (!fullState.sessions) fullState.sessions = {};
  if (!fullState.sessions[session]) {
    fullState.sessions[session] = { ...DEFAULT_SESSION_DAILY };
  }

  const target = fullState.sessions[session];
  target.entries = (ds.entries || []).slice(-MAX_DAILY_ENTRIES);
  target.currentSprint = ds.currentSprint ?? target.currentSprint;
  target.sprintStart = ds.sprintStart ?? target.sprintStart;
  target.sprintEnd = ds.sprintEnd ?? target.sprintEnd;
  target.sessionId = session;
  target.lastUpdated = new Date().toISOString();

  writeJson(dailyPath, fullState);
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getOrCreateTodayEntry(ds, sessionId) {
  const session = sessionId || getSessionId();
  const fullState = loadDailyState(session);
  const sessionState = fullState.sessions[session] || { ...DEFAULT_SESSION_DAILY };
  const key = getTodayKey();
  let entry = sessionState.entries.find((e) => e.date === key);
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
      sessionId: session,
    };
    sessionState.entries.push(entry);
    saveDailyState(sessionState, session);
  }
  return { entry, sessionState, fullState };
}

function addDailyGoal(ds, goal, sessionId) {
  const session = sessionId || getSessionId();
  const { entry, sessionState } = getOrCreateTodayEntry(ds, session);
  entry.goals.push({ text: goal, status: "pending", createdAt: new Date().toISOString(), sessionId: session });
  saveDailyState(sessionState, session);
  return entry;
}

function completeDailyGoal(ds, goalText, sessionId) {
  const session = sessionId || getSessionId();
  const { entry, sessionState } = getOrCreateTodayEntry(ds, session);
  const goal = entry.goals.find((g) => g.text === goalText);
  if (goal) {
    goal.status = "completed";
    goal.completedAt = new Date().toISOString();
    entry.completed.push(goalText);
  }
  saveDailyState(sessionState, session);
  return entry;
}

function addBlockedItem(ds, item, sessionId) {
  const session = sessionId || getSessionId();
  const { entry, sessionState } = getOrCreateTodayEntry(ds, session);
  entry.blocked.push({ text: item, createdAt: new Date().toISOString(), sessionId: session });
  saveDailyState(sessionState, session);
  return entry;
}

function recordDailyMetrics(ds, metricsUpdate, sessionId) {
  const session = sessionId || getSessionId();
  const { entry, sessionState } = getOrCreateTodayEntry(ds, session);
  Object.assign(entry.metrics, metricsUpdate);
  saveDailyState(sessionState, session);
  return entry;
}

function writeDailyJournal(ds, journalText, sessionId) {
  const session = sessionId || getSessionId();
  const { entry, sessionState } = getOrCreateTodayEntry(ds, session);
  entry.dailyJournal = journalText;
  saveDailyState(sessionState, session);
  return entry;
}

function generateDailySummary(ds, sessionId) {
  const session = sessionId || getSessionId();
  const { entry, sessionState, fullState } = getOrCreateTodayEntry(ds, session);
  const ps = loadProjectState(null, session);
  const sessionProject = ps.sessions?.[session] || { tasks: [], techDebt: [], velocity: { averageVelocity: 0 }, epics: [], milestones: [], stories: [] };
  const completedTasks = sessionProject.tasks.filter((t) => t.status === "completed" || t.status === "done");
  const pendingTasks = sessionProject.tasks.filter((t) => t.status === "backlog" || t.status === "in-progress");
  const unresolvedDebt = sessionProject.techDebt.filter((d) => d.status === "unresolved");

  const summary = {
    date: entry.date,
    goalsToday: entry.goals.length,
    completedToday: entry.completed.length,
    blockedToday: entry.blocked.length,
    totalTasks: sessionProject.tasks.length,
    completedTasks: completedTasks.length,
    pendingTasks: pendingTasks.length,
    completionPercent:
      sessionProject.tasks.length > 0
        ? Math.round((completedTasks.length / sessionProject.tasks.length) * 100)
        : 0,
    unresolvedTechDebt: unresolvedDebt.length,
    totalTechDebt: sessionProject.techDebt.length,
    velocity: sessionProject.velocity.averageVelocity,
    epicCount: sessionProject.epics.length,
    milestoneCount: sessionProject.milestones.length,
    storyCount: sessionProject.stories.length,
    metrics: entry.metrics,
    blocked: entry.blocked,
    priorities: entry.priorities,
    nextActions: entry.nextActions,
  };

  entry.summary = JSON.stringify(summary);
  saveDailyState(sessionState, session);
  return summary;
}

function generateWeeklySummary(ds, sessionId) {
  const session = sessionId || getSessionId();
  const fullState = loadDailyState(session);
  const sessionState = fullState.sessions[session] || { ...DEFAULT_SESSION_DAILY };
  const entries = sessionState.entries;
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekKey = weekAgo.toISOString().slice(0, 10);

  const weekEntries = entries.filter((e) => e.date >= weekKey);
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
    entries: weekEntries.map((e) => ({
      date: e.date,
      goals: e.goals.length,
      completed: e.completed.length,
      metrics: e.metrics,
    })),
  };
}

function generateDailyEngineeringJournal(ds, sessionId) {
  const session = sessionId || getSessionId();
  const { entry, sessionState } = getOrCreateTodayEntry(ds, session);
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

function startSprint(ds, sprintName, durationDays, sessionId) {
  const session = sessionId || getSessionId();
  const { sessionState } = getOrCreateTodayEntry(ds, session);
  sessionState.currentSprint = sprintName;
  sessionState.sprintStart = new Date().toISOString();
  const end = new Date();
  end.setDate(end.getDate() + (durationDays || 14));
  sessionState.sprintEnd = end.toISOString();
  saveDailyState(sessionState, session);
  return { sprint: sprintName, start: sessionState.sprintStart, end: sessionState.sprintEnd };
}

function getSessionDailyState(dailyState, sessionId) {
  const session = sessionId || getSessionId();
  if (!dailyState.sessions) return { ...DEFAULT_SESSION_DAILY };
  return dailyState.sessions[session] || { ...DEFAULT_SESSION_DAILY };
}

function getAggregatedDailyState(dailyState) {
  if (!dailyState.sessions) return { ...DEFAULT_SESSION_DAILY };

  const aggregated = { ...DEFAULT_SESSION_DAILY };
  for (const [, sessionDaily] of Object.entries(dailyState.sessions)) {
    if (!sessionDaily) continue;
    aggregated.entries.push(...(sessionDaily.entries || []));
    if (sessionDaily.currentSprint) aggregated.currentSprint = sessionDaily.currentSprint;
    if (sessionDaily.sprintStart) aggregated.sprintStart = sessionDaily.sprintStart;
    if (sessionDaily.sprintEnd) aggregated.sprintEnd = sessionDaily.sprintEnd;
  }
  aggregated.entries.sort((a, b) => a.date.localeCompare(b.date));
  if (aggregated.entries.length > MAX_DAILY_ENTRIES) {
    aggregated.entries = aggregated.entries.slice(-MAX_DAILY_ENTRIES);
  }
  return aggregated;
}

module.exports = {
  DAILY_PATH,
  DEFAULT_SESSION_DAILY,
  DEFAULT_DAILY_STATE,
  getSessionId,
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
  getSessionDailyState,
  getAggregatedDailyState,
  migrateToSessions,
  atomicWrite,
};
