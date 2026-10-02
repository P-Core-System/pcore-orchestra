"use strict";

const path = require("node:path");
const {
  MAX_EPICS,
  MAX_MILESTONES,
  MAX_STORIES,
  MAX_TASKS,
  MAX_BACKLOG_ITEMS,
  MAX_TECH_DEBT_ITEMS,
  MAX_ADRS,
  MAX_RETROSPECTIVES,
} = require("./constants.js");
const { loadProjectIdentity, saveProjectIdentity, buildIdentitySummary } = require("./project-identity.js");
const { writeJson, readJsonSafe, resolveStatePath } = require("./safe-write.js");

const PROJECT_PATH = path.join(__dirname, "..", "state", "orchestra-project.json");

const DEFAULT_SESSION_PROJECT = {
  vision: "",
  goals: [],
  epics: [],
  milestones: [],
  stories: [],
  tasks: [],
  backlog: [],
  techDebt: [],
  adrs: [],
  retrospectives: [],
  velocity: {
    completedPoints: [],
    averageVelocity: 0,
    sprintCount: 0,
  },
  identity: {
    name: "",
    slug: "",
    displayName: "",
    type: "",
    owner: "",
    syncedAt: null,
  },
};

const DEFAULT_PROJECT_STATE = {
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

/** Migrate legacy flat project state to session-namespaced structure. */
function migrateToSessions(raw) {
  if (raw && raw.sessions && typeof raw.sessions === "object") {
    return raw;
  }

  const sessionId = getSessionId();
  const migrated = {
    version: 1,
    sessions: {},
  };
  migrated.sessions[sessionId] = { ...DEFAULT_SESSION_PROJECT, ...(raw || {}) };
  return migrated;
}

function ringCap(arr, max) {
  if (arr.length > max) return arr.slice(-max);
  return arr;
}

function loadProjectState(identityRootDir, sessionId) {
  const session = sessionId || getSessionId();
  try {
    const raw = readJsonSafe(resolveStatePath(PROJECT_PATH), { version: 1, sessions: {} });
    const migrated = migrateToSessions(raw);
    if (!migrated.sessions[session]) {
      migrated.sessions[session] = { ...DEFAULT_SESSION_PROJECT };
      if (identityRootDir) syncIdentity(migrated.sessions[session], identityRootDir);
    } else if (identityRootDir) {
      syncIdentity(migrated.sessions[session], identityRootDir);
    }
    return migrated;
  } catch {
    const fresh = { version: 1, sessions: {} };
    fresh.sessions[session] = { ...DEFAULT_SESSION_PROJECT };
    if (identityRootDir) syncIdentity(fresh.sessions[session], identityRootDir);
    return fresh;
  }
}

function syncIdentity(ps, identityRootDir) {
  if (!identityRootDir) return;
  const identity = loadProjectIdentity(identityRootDir);
  if (!identity) return;

  ps.identity.name = identity.project.name || ps.identity.name;
  ps.identity.slug = identity.project.slug || ps.identity.slug;
  ps.identity.displayName = identity.project.display_name || ps.identity.displayName;
  ps.identity.type = identity.project.type || ps.identity.type;
  ps.identity.owner = identity.project.owner || ps.identity.owner;
  ps.identity.syncedAt = new Date().toISOString();
  ps.vision = identity.project.description || ps.vision;
}

function saveProjectState(ps, sessionId) {
  const session = sessionId || getSessionId();
  const projectPath = resolveStatePath(PROJECT_PATH);
  const fullState = migrateToSessions(readJsonSafe(projectPath, { version: 1, sessions: {} }));

  if (!fullState.sessions) fullState.sessions = {};
  if (!fullState.sessions[session]) {
    fullState.sessions[session] = { ...DEFAULT_SESSION_PROJECT };
  }

  const target = fullState.sessions[session];
  target.vision = ps.vision;
  target.goals = ringCap(ps.goals || [], MAX_EPICS);
  target.epics = ringCap(ps.epics || [], MAX_EPICS);
  target.milestones = ringCap(ps.milestones || [], MAX_MILESTONES);
  target.stories = ringCap(ps.stories || [], MAX_STORIES);
  target.tasks = ringCap(ps.tasks || [], MAX_TASKS);
  target.backlog = ringCap(ps.backlog || [], MAX_BACKLOG_ITEMS);
  target.techDebt = ringCap(ps.techDebt || [], MAX_TECH_DEBT_ITEMS);
  target.adrs = ringCap(ps.adrs || [], MAX_ADRS);
  target.retrospectives = ringCap(ps.retrospectives || [], MAX_RETROSPECTIVES);
  target.velocity = ps.velocity || { ...DEFAULT_SESSION_PROJECT.velocity };
  target.identity = ps.identity || { ...DEFAULT_SESSION_PROJECT.identity };

  // Tag with session ownership
  target.sessionId = session;
  target.lastUpdated = new Date().toISOString();

  writeJson(projectPath, fullState);
}

function generateId() {
  return "item-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

function addEpic(ps, { title, description, priority, goal }, sessionId) {
  const epic = {
    id: generateId(),
    title,
    description,
    priority: priority || "medium",
    goal: goal || "",
    status: "backlog",
    createdAt: new Date().toISOString(),
    milestoneIds: [],
    storyIds: [],
    sessionId: sessionId || getSessionId(),
  };
  ps.epics.push(epic);
  saveProjectState(ps, sessionId);
  return epic;
}

function addMilestone(ps, { title, description, dueDate, epicId }, sessionId) {
  const milestone = {
    id: generateId(),
    title,
    description,
    dueDate: dueDate || null,
    epicId: epicId || null,
    status: "planned",
    createdAt: new Date().toISOString(),
    completedAt: null,
    storyIds: [],
    sessionId: sessionId || getSessionId(),
  };
  ps.milestones.push(milestone);
  if (epicId) {
    const epic = ps.epics.find((e) => e.id === epicId);
    if (epic) epic.milestoneIds.push(milestone.id);
  }
  saveProjectState(ps, sessionId);
  return milestone;
}

function addStory(ps, { title, description, acceptanceCriteria, epicId, milestoneId, storyPoints, priority, labels }, sessionId) {
  const story = {
    id: generateId(),
    title,
    description,
    acceptanceCriteria: acceptanceCriteria || [],
    epicId: epicId || null,
    milestoneId: milestoneId || null,
    storyPoints: storyPoints || 0,
    priority: priority || "medium",
    labels: labels || [],
    status: "backlog",
    createdAt: new Date().toISOString(),
    taskIds: [],
    assignee: null,
    sessionId: sessionId || getSessionId(),
  };
  ps.stories.push(story);
  saveProjectState(ps, sessionId);
  return story;
}

function addTask(ps, { title, description, storyId, assignee, estimatedHours, priority, labels }, sessionId) {
  const task = {
    id: generateId(),
    title,
    description,
    storyId: storyId || null,
    assignee: assignee || null,
    estimatedHours: estimatedHours || 0,
    actualHours: 0,
    priority: priority || "medium",
    labels: labels || [],
    status: "backlog",
    createdAt: new Date().toISOString(),
    completedAt: null,
    riskLevel: "low",
    complexity: "medium",
    dependencies: [],
    sessionId: sessionId || getSessionId(),
  };
  ps.tasks.push(task);
  if (storyId) {
    const story = ps.stories.find((s) => s.id === storyId);
    if (story) story.taskIds.push(task.id);
  }
  saveProjectState(ps, sessionId);
  return task;
}

function addBacklogItem(ps, { title, description, type, priority, labels, source }, sessionId) {
  const item = {
    id: generateId(),
    title,
    description,
    type: type || "feature",
    priority: priority || "medium",
    labels: labels || [],
    source: source || "manual",
    status: "backlog",
    createdAt: new Date().toISOString(),
    sessionId: sessionId || getSessionId(),
  };
  ps.backlog.push(item);
  saveProjectState(ps, sessionId);
  return item;
}

function addTechDebt(ps, { title, description, impact, area, severity, suggestedFix }, sessionId) {
  const debt = {
    id: generateId(),
    title,
    description,
    impact: impact || "",
    area: area || "",
    severity: severity || "medium",
    suggestedFix: suggestedFix || "",
    status: "unresolved",
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    sessionId: sessionId || getSessionId(),
  };
  ps.techDebt.push(debt);
  saveProjectState(ps, sessionId);
  return debt;
}

function addAdr(ps, { title, context, decision, consequences, status, drivers }, sessionId) {
  const adr = {
    id: generateId(),
    title,
    context: context || "",
    decision: decision || "",
    consequences: consequences || "",
    status: status || "proposed",
    drivers: drivers || [],
    createdAt: new Date().toISOString(),
    supersededBy: null,
    sessionId: sessionId || getSessionId(),
  };
  ps.adrs.push(adr);
  saveProjectState(ps, sessionId);
  return adr;
}

function addRetrospective(ps, { sprint, wentWell, toImprove, actionItems, lessons }, sessionId) {
  const retro = {
    id: generateId(),
    sprint: sprint || "",
    date: new Date().toISOString(),
    wentWell: wentWell || [],
    toImprove: toImprove || [],
    actionItems: actionItems || [],
    lessons: lessons || [],
    sessionId: sessionId || getSessionId(),
  };
  ps.retrospectives.push(retro);
  saveProjectState(ps, sessionId);
  return retro;
}

function updateTaskStatus(ps, taskId, status, actualHours, sessionId) {
  const task = ps.tasks.find((t) => t.id === taskId);
  if (!task) return null;
  task.status = status;
  if (actualHours !== undefined) task.actualHours = actualHours;
  if (status === "completed" || status === "done") {
    task.completedAt = new Date().toISOString();
  }
  saveProjectState(ps, sessionId);
  return task;
}

function updateStoryStatus(ps, storyId, status, sessionId) {
  const story = ps.stories.find((s) => s.id === storyId);
  if (!story) return null;
  story.status = status;
  saveProjectState(ps, sessionId);
  return story;
}

function updateMilestoneStatus(ps, milestoneId, status, sessionId) {
  const milestone = ps.milestones.find((m) => m.id === milestoneId);
  if (!milestone) return null;
  milestone.status = status;
  if (status === "completed") milestone.completedAt = new Date().toISOString();
  saveProjectState(ps, sessionId);
  return milestone;
}

function updateEpicStatus(ps, epicId, status, sessionId) {
  const epic = ps.epics.find((e) => e.id === epicId);
  if (!epic) return null;
  epic.status = status;
  saveProjectState(ps, sessionId);
  return epic;
}

function trackVelocity(ps, sprintName, completedPoints, sessionId) {
  ps.velocity.completedPoints.push({
    sprint: sprintName,
    points: completedPoints,
    date: new Date().toISOString(),
  });
  const total = ps.velocity.completedPoints.reduce((s, p) => s + p.points, 0);
  ps.velocity.sprintCount = ps.velocity.completedPoints.length;
  ps.velocity.averageVelocity =
    ps.velocity.sprintCount > 0 ? Math.round(total / ps.velocity.sprintCount) : 0;
  saveProjectState(ps, sessionId);
}

function generateBurndown(ps, sprintName) {
  const sprintTasks = ps.tasks.filter(
    (t) => t.labels && t.labels.includes(sprintName)
  );
  const total = sprintTasks.length;
  const completed = sprintTasks.filter(
    (t) => t.status === "completed" || t.status === "done"
  ).length;
  const remaining = total - completed;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { total, completed, remaining, percent };
}

function generateProjectSummary(ps) {
  const totalEpics = ps.epics.length;
  const totalMilestones = ps.milestones.length;
  const totalStories = ps.stories.length;
  const totalTasks = ps.tasks.length;
  const totalBacklog = ps.backlog.length;
  const totalTechDebt = ps.techDebt.length;
  const totalAdrs = ps.adrs.length;
  const completedTasks = ps.tasks.filter(
    (t) => t.status === "completed" || t.status === "done"
  ).length;
  const unresolvedDebt = ps.techDebt.filter((d) => d.status === "unresolved").length;
  return {
    totalEpics,
    totalMilestones,
    totalStories,
    totalTasks,
    totalBacklog,
    totalTechDebt,
    totalAdrs,
    completedTasks,
    unresolvedDebt,
    velocity: ps.velocity.averageVelocity,
    sprintCount: ps.velocity.sprintCount,
  };
}

function getSessionProjectState(projectState, sessionId) {
  const session = sessionId || getSessionId();
  if (!projectState.sessions) return { ...DEFAULT_SESSION_PROJECT };
  return projectState.sessions[session] || { ...DEFAULT_SESSION_PROJECT };
}

function getAggregatedProjectState(projectState) {
  if (!projectState.sessions) return { ...DEFAULT_SESSION_PROJECT };

  const aggregated = { ...DEFAULT_SESSION_PROJECT };
  const seenEpics = new Set();
  const seenMilestones = new Set();
  const seenStories = new Set();
  const seenTasks = new Set();

  for (const [, sessionProj] of Object.entries(projectState.sessions)) {
    if (!sessionProj) continue;

    // Merge unique items by ID
    for (const e of sessionProj.epics || []) {
      if (!seenEpics.has(e.id)) {
        seenEpics.add(e.id);
        aggregated.epics.push(e);
      }
    }
    for (const m of sessionProj.milestones || []) {
      if (!seenMilestones.has(m.id)) {
        seenMilestones.add(m.id);
        aggregated.milestones.push(m);
      }
    }
    for (const s of sessionProj.stories || []) {
      if (!seenStories.has(s.id)) {
        seenStories.add(s.id);
        aggregated.stories.push(s);
      }
    }
    for (const t of sessionProj.tasks || []) {
      if (!seenTasks.has(t.id)) {
        seenTasks.add(t.id);
        aggregated.tasks.push(t);
      }
    }
    aggregated.goals.push(...(sessionProj.goals || []));
    aggregated.backlog.push(...(sessionProj.backlog || []));
    aggregated.techDebt.push(...(sessionProj.techDebt || []));
    aggregated.adrs.push(...(sessionProj.adrs || []));
    aggregated.retrospectives.push(...(sessionProj.retrospectives || []));

    // Merge velocity (sum)
    aggregated.velocity.completedPoints.push(...(sessionProj.velocity?.completedPoints || []));
  }

  // Recalculate velocity
  const total = aggregated.velocity.completedPoints.reduce((s, p) => s + p.points, 0);
  aggregated.velocity.sprintCount = aggregated.velocity.completedPoints.length;
  aggregated.velocity.averageVelocity =
    aggregated.velocity.sprintCount > 0 ? Math.round(total / aggregated.velocity.sprintCount) : 0;

  return aggregated;
}

module.exports = {
  PROJECT_PATH,
  DEFAULT_SESSION_PROJECT,
  DEFAULT_PROJECT_STATE,
  getSessionId,
  loadProjectState,
  saveProjectState,
  generateId,
  syncIdentity,
  addEpic,
  addMilestone,
  addStory,
  addTask,
  addBacklogItem,
  addTechDebt,
  addAdr,
  addRetrospective,
  updateTaskStatus,
  updateStoryStatus,
  updateMilestoneStatus,
  updateEpicStatus,
  trackVelocity,
  generateBurndown,
  generateProjectSummary,
  getSessionProjectState,
  getAggregatedProjectState,
  migrateToSessions,
};
