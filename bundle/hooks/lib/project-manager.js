"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  MAX_EPICS, MAX_MILESTONES, MAX_STORIES, MAX_TASKS,
  MAX_BACKLOG_ITEMS, MAX_TECH_DEBT_ITEMS, MAX_ADRS, MAX_RETROSPECTIVES,
} = require("./constants.js");

const PROJECT_PATH = path.join(__dirname, "..", "state", "orchestra-project.json");

const DEFAULT_PROJECT_STATE = {
  version: 1,
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
};

function ringCap(arr, max) {
  if (arr.length > max) return arr.slice(-max);
  return arr;
}

function loadProjectState() {
  try {
    if (!fs.existsSync(PROJECT_PATH)) return { ...DEFAULT_PROJECT_STATE, epics: [], milestones: [], stories: [], tasks: [], backlog: [], techDebt: [], adrs: [], retrospectives: [] };
    const raw = JSON.parse(fs.readFileSync(PROJECT_PATH, "utf8"));
    return { ...DEFAULT_PROJECT_STATE, ...raw };
  } catch {
    return { ...DEFAULT_PROJECT_STATE };
  }
}

function saveProjectState(ps) {
  fs.mkdirSync(path.dirname(PROJECT_PATH), { recursive: true });
  ps.epics = ringCap(ps.epics, MAX_EPICS);
  ps.milestones = ringCap(ps.milestones, MAX_MILESTONES);
  ps.stories = ringCap(ps.stories, MAX_STORIES);
  ps.tasks = ringCap(ps.tasks, MAX_TASKS);
  ps.backlog = ringCap(ps.backlog, MAX_BACKLOG_ITEMS);
  ps.techDebt = ringCap(ps.techDebt, MAX_TECH_DEBT_ITEMS);
  ps.adrs = ringCap(ps.adrs, MAX_ADRS);
  ps.retrospectives = ringCap(ps.retrospectives, MAX_RETROSPECTIVES);
  fs.writeFileSync(PROJECT_PATH, JSON.stringify(ps, null, 2));
}

function generateId() {
  return "item-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

function addEpic(ps, { title, description, priority, goal }) {
  const epic = {
    id: generateId(),
    title, description, priority: priority || "medium",
    goal: goal || "",
    status: "backlog",
    createdAt: new Date().toISOString(),
    milestoneIds: [],
    storyIds: [],
  };
  ps.epics.push(epic);
  saveProjectState(ps);
  return epic;
}

function addMilestone(ps, { title, description, dueDate, epicId }) {
  const milestone = {
    id: generateId(),
    title, description, dueDate: dueDate || null,
    epicId: epicId || null,
    status: "planned",
    createdAt: new Date().toISOString(),
    completedAt: null,
    storyIds: [],
  };
  ps.milestones.push(milestone);
  if (epicId) {
    const epic = ps.epics.find(e => e.id === epicId);
    if (epic) epic.milestoneIds.push(milestone.id);
  }
  saveProjectState(ps);
  return milestone;
}

function addStory(ps, {
  title, description, acceptanceCriteria, epicId, milestoneId,
  storyPoints, priority, labels,
}) {
  const story = {
    id: generateId(),
    title, description,
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
  };
  ps.stories.push(story);
  saveProjectState(ps);
  return story;
}

function addTask(ps, {
  title, description, storyId, assignee, estimatedHours, priority, labels,
}) {
  const task = {
    id: generateId(),
    title, description,
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
  };
  ps.tasks.push(task);
  if (storyId) {
    const story = ps.stories.find(s => s.id === storyId);
    if (story) story.taskIds.push(task.id);
  }
  saveProjectState(ps);
  return task;
}

function addBacklogItem(ps, { title, description, type, priority, labels, source }) {
  const item = {
    id: generateId(),
    title, description, type: type || "feature",
    priority: priority || "medium",
    labels: labels || [],
    source: source || "manual",
    status: "backlog",
    createdAt: new Date().toISOString(),
  };
  ps.backlog.push(item);
  saveProjectState(ps);
  return item;
}

function addTechDebt(ps, { title, description, impact, area, severity, suggestedFix }) {
  const debt = {
    id: generateId(),
    title, description, impact: impact || "",
    area: area || "",
    severity: severity || "medium",
    suggestedFix: suggestedFix || "",
    status: "unresolved",
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  };
  ps.techDebt.push(debt);
  saveProjectState(ps);
  return debt;
}

function addAdr(ps, { title, context, decision, consequences, status, drivers }) {
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
  };
  ps.adrs.push(adr);
  saveProjectState(ps);
  return adr;
}

function addRetrospective(ps, { sprint, wentWell, toImprove, actionItems, lessons }) {
  const retro = {
    id: generateId(),
    sprint: sprint || "",
    date: new Date().toISOString(),
    wentWell: wentWell || [],
    toImprove: toImprove || [],
    actionItems: actionItems || [],
    lessons: lessons || [],
  };
  ps.retrospectives.push(retro);
  saveProjectState(ps);
  return retro;
}

function updateTaskStatus(ps, taskId, status, actualHours) {
  const task = ps.tasks.find(t => t.id === taskId);
  if (!task) return null;
  task.status = status;
  if (actualHours !== undefined) task.actualHours = actualHours;
  if (status === "completed" || status === "done") {
    task.completedAt = new Date().toISOString();
  }
  saveProjectState(ps);
  return task;
}

function updateStoryStatus(ps, storyId, status) {
  const story = ps.stories.find(s => s.id === storyId);
  if (!story) return null;
  story.status = status;
  saveProjectState(ps);
  return story;
}

function updateMilestoneStatus(ps, milestoneId, status) {
  const milestone = ps.milestones.find(m => m.id === milestoneId);
  if (!milestone) return null;
  milestone.status = status;
  if (status === "completed") milestone.completedAt = new Date().toISOString();
  saveProjectState(ps);
  return milestone;
}

function updateEpicStatus(ps, epicId, status) {
  const epic = ps.epics.find(e => e.id === epicId);
  if (!epic) return null;
  epic.status = status;
  saveProjectState(ps);
  return epic;
}

function trackVelocity(ps, sprintName, completedPoints) {
  ps.velocity.completedPoints.push({
    sprint: sprintName,
    points: completedPoints,
    date: new Date().toISOString(),
  });
  const total = ps.velocity.completedPoints.reduce((s, p) => s + p.points, 0);
  ps.velocity.sprintCount = ps.velocity.completedPoints.length;
  ps.velocity.averageVelocity = ps.velocity.sprintCount > 0
    ? Math.round(total / ps.velocity.sprintCount) : 0;
  saveProjectState(ps);
}

function generateBurndown(ps, sprintName) {
  const sprintTasks = ps.tasks.filter(t =>
    t.labels && t.labels.includes(sprintName)
  );
  const total = sprintTasks.length;
  const completed = sprintTasks.filter(t => t.status === "completed" || t.status === "done").length;
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
  const completedTasks = ps.tasks.filter(t => t.status === "completed" || t.status === "done").length;
  const unresolvedDebt = ps.techDebt.filter(d => d.status === "unresolved").length;
  return {
    totalEpics, totalMilestones, totalStories, totalTasks, totalBacklog,
    totalTechDebt, totalAdrs, completedTasks, unresolvedDebt,
    velocity: ps.velocity.averageVelocity,
    sprintCount: ps.velocity.sprintCount,
  };
}

module.exports = {
  PROJECT_PATH,
  DEFAULT_PROJECT_STATE,
  loadProjectState,
  saveProjectState,
  generateId,
  addEpic, addMilestone, addStory, addTask,
  addBacklogItem, addTechDebt, addAdr, addRetrospective,
  updateTaskStatus, updateStoryStatus, updateMilestoneStatus, updateEpicStatus,
  trackVelocity, generateBurndown, generateProjectSummary,
};
