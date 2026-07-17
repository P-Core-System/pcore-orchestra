"use strict";

// --- Core caps ---
const LIFECYCLE_MAX_EVENTS = 200;
const MEMORY_MAX_COMPLETED = 100;
const MEMORY_MAX_RECENT_FILES = 50;
const MEMORY_MAX_ERROR_PATTERNS = 50;
const HISTORY_MAX_RUNS = 50;
const PROMPT_MIN_LENGTH = 8;
const GOAL_MAX_LENGTH = 2000;
const CLASSIFICATION_MULTISTEP_MIN_LENGTH = 120;
const DEFAULT_MAX_ITERATIONS = 8;
const DEFAULT_STALL_THRESHOLD_MS = 300000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 60000;
const DEFAULT_STALE_THRESHOLD_MS = 600000;
const CRASH_RECOVERY_THRESHOLD_MS = 600000;
const RECENT_GOALS_DISPLAY_COUNT = 5;
const TOP_FILES_DISPLAY_COUNT = 5;
const TOP_ERRORS_DISPLAY_COUNT = 3;
const STALL_ATTEMPTS_ABORT_THRESHOLD = 2;
const STOP_NUDGE_LOOP_LIMIT = 3;

// --- V3 Enterprise caps ---
const MAX_EPICS = 50;
const MAX_MILESTONES = 100;
const MAX_STORIES = 500;
const MAX_TASKS = 2000;
const MAX_BACKLOG_ITEMS = 500;
const MAX_TECH_DEBT_ITEMS = 200;
const MAX_ADRS = 200;
const MAX_RETROSPECTIVES = 100;
const MAX_CHANGELOG_ENTRIES = 500;
const MAX_RELEASES = 100;
const MAX_DAILY_ENTRIES = 365;
const MAX_METRICS_POINTS = 1000;
const MAX_SLOS = 20;
const MAX_INCIDENTS = 200;

// --- Project identity ---
const PROJECT_YAML_NAME = "project.yaml";
const PROJECT_JSON_NAME = "project.json";
const PROJECT_IDENTITY_VERSION = 1;

// --- Semver ---
const SEMVER_MAJOR = "major";
const SEMVER_MINOR = "minor";
const SEMVER_PATCH = "patch";
const INITIAL_VERSION = "1.0.0";
const INITIAL_BUILD = 1;

// --- Phase chain V3 ---
const SDLC_PHASES = [
  { id: "idea", category: "discovery", agent: "business-analyst", readonly: true },
  { id: "analysis", category: "discovery", agent: "business-analyst", readonly: true },
  { id: "requirements", category: "discovery", agent: "business-analyst", readonly: true },
  { id: "functional-req", category: "discovery", agent: "product-manager", readonly: true },
  { id: "nonfunctional-req", category: "discovery", agent: "product-manager", readonly: true },
  { id: "user-stories", category: "design", agent: "product-manager", readonly: true },
  { id: "acceptance-criteria", category: "design", agent: "product-manager", readonly: true },
  { id: "use-cases", category: "design", agent: "architect", readonly: true },
  { id: "domain-model", category: "design", agent: "architect", readonly: true },
  { id: "risk-analysis", category: "design", agent: "architect", readonly: true },
  { id: "architecture-review", category: "design", agent: "architect", readonly: true },
  { id: "tech-selection", category: "design", agent: "tech-lead", readonly: true },
  { id: "folder-structure", category: "design", agent: "tech-lead", readonly: true },
  { id: "coding-standards", category: "design", agent: "tech-lead", readonly: true },
  { id: "sprint-planning", category: "planning", agent: "project-manager", readonly: true },
  { id: "milestone-planning", category: "planning", agent: "project-manager", readonly: true },
  { id: "task-breakdown", category: "planning", agent: "project-manager", readonly: true },
  { id: "implementation", category: "execution", agent: "implementer", readonly: false },
  { id: "unit-testing", category: "execution", agent: "qa-engineer", readonly: true },
  { id: "integration-testing", category: "quality", agent: "qa-engineer", readonly: true },
  { id: "regression-testing", category: "quality", agent: "automation-engineer", readonly: true },
  { id: "performance-testing", category: "quality", agent: "performance-engineer", readonly: true },
  { id: "security-review", category: "quality", agent: "security-engineer", readonly: true },
  { id: "accessibility-review", category: "quality", agent: "accessibility-reviewer", readonly: true },
  { id: "documentation", category: "release", agent: "documentation-writer", readonly: true },
  { id: "release-candidate", category: "release", agent: "release-manager", readonly: true },
  { id: "production-release", category: "release", agent: "devops-engineer", readonly: true },
  { id: "monitoring", category: "operations", agent: "sre", readonly: true },
  { id: "analytics", category: "operations", agent: "observer", readonly: true },
  { id: "maintenance", category: "operations", agent: "sre", readonly: true },
  { id: "retrospective", category: "operations", agent: "project-manager", readonly: true },
  { id: "continuous-improvement", category: "operations", agent: "project-manager", readonly: true },
];

const PHASE_IDS = SDLC_PHASES.map(p => p.id);

// --- Quality gate IDs ---
const QUALITY_GATES = [
  "build", "tests", "coverage", "lint", "security",
  "reviewer-approval", "docs-updated", "version-updated",
  "changelog-updated", "roadmap-updated", "memory-updated",
  "daily-journal-updated", "release-notes-updated", "tech-debt-recorded",
];

module.exports = {
  LIFECYCLE_MAX_EVENTS,
  MEMORY_MAX_COMPLETED,
  MEMORY_MAX_RECENT_FILES,
  MEMORY_MAX_ERROR_PATTERNS,
  HISTORY_MAX_RUNS,
  PROMPT_MIN_LENGTH,
  GOAL_MAX_LENGTH,
  CLASSIFICATION_MULTISTEP_MIN_LENGTH,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_STALL_THRESHOLD_MS,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_STALE_THRESHOLD_MS,
  CRASH_RECOVERY_THRESHOLD_MS,
  RECENT_GOALS_DISPLAY_COUNT,
  TOP_FILES_DISPLAY_COUNT,
  TOP_ERRORS_DISPLAY_COUNT,
  STALL_ATTEMPTS_ABORT_THRESHOLD,
  STOP_NUDGE_LOOP_LIMIT,
  MAX_EPICS,
  MAX_MILESTONES,
  MAX_STORIES,
  MAX_TASKS,
  MAX_BACKLOG_ITEMS,
  MAX_TECH_DEBT_ITEMS,
  MAX_ADRS,
  MAX_RETROSPECTIVES,
  MAX_CHANGELOG_ENTRIES,
  MAX_RELEASES,
  MAX_DAILY_ENTRIES,
  MAX_METRICS_POINTS,
  MAX_SLOS,
  MAX_INCIDENTS,
  PROJECT_YAML_NAME,
  PROJECT_JSON_NAME,
  PROJECT_IDENTITY_VERSION,
  SEMVER_MAJOR,
  SEMVER_MINOR,
  SEMVER_PATCH,
  INITIAL_VERSION,
  INITIAL_BUILD,
  SDLC_PHASES,
  PHASE_IDS,
  QUALITY_GATES,
};
