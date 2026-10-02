"use strict";

const path = require("node:path");
const { INITIAL_VERSION, INITIAL_BUILD, MAX_RELEASES, MAX_CHANGELOG_ENTRIES } = require("./constants.js");
const { loadProjectIdentity, saveProjectIdentity, recordVersionBump } = require("./project-identity.js");
const { writeJson, readJsonSafe, resolveStatePath, atomicWrite } = require("./safe-write.js");

const VERSION_PATH = path.join(__dirname, "..", "state", "orchestra-version.json");

const RELEASE_THEMES = [
  "Genesis", "Foundation", "Momentum", "Expansion", "Horizon",
  "Catalyst", "Summit", "Pinnacle", "Evolution", "Transcend",
];

function getReleaseTheme(major) {
  return RELEASE_THEMES[Math.min(major, RELEASE_THEMES.length - 1)] || "Unknown";
}

function getReleaseSlug(version) {
  return "v" + version.replace(/\./g, "-");
}

const DEFAULT_SESSION_VERSION = {
  current: INITIAL_VERSION,
  buildNumber: INITIAL_BUILD,
  previous: null,
  bumpType: null,
  releaseName: null,
  releaseSlug: null,
  releaseTheme: null,
  releaseDate: null,
  gitSha: null,
  releases: [],
  changelog: [],
  breakingChanges: [],
  migrationNotes: [],
};

const DEFAULT_VERSION_STATE = {
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

/** Migrate legacy flat version state to session-namespaced structure. */
function migrateToSessions(raw) {
  if (raw && raw.sessions && typeof raw.sessions === "object") {
    return raw;
  }

  const sessionId = getSessionId();
  const migrated = {
    version: 1,
    sessions: {},
  };
  migrated.sessions[sessionId] = { ...DEFAULT_SESSION_VERSION, ...(raw || {}) };
  return migrated;
}

function loadVersionState(sessionId) {
  const session = sessionId || getSessionId();
  try {
    const raw = readJsonSafe(resolveStatePath(VERSION_PATH), { version: 1, sessions: {} });
    const migrated = migrateToSessions(raw);
    if (!migrated.sessions[session]) {
      migrated.sessions[session] = { ...DEFAULT_SESSION_VERSION };
    }
    return migrated;
  } catch {
    const fresh = { version: 1, sessions: {} };
    fresh.sessions[session] = { ...DEFAULT_SESSION_VERSION };
    return fresh;
  }
}

function saveVersionState(vs, sessionId) {
  const session = sessionId || getSessionId();
  const versionPath = resolveStatePath(VERSION_PATH);
  const fullState = migrateToSessions(readJsonSafe(versionPath, { version: 1, sessions: {} }));

  if (!fullState.sessions) fullState.sessions = {};
  if (!fullState.sessions[session]) {
    fullState.sessions[session] = { ...DEFAULT_SESSION_VERSION };
  }

  const target = fullState.sessions[session];
  target.current = vs.current ?? target.current;
  target.buildNumber = vs.buildNumber ?? target.buildNumber;
  target.previous = vs.previous ?? target.previous;
  target.bumpType = vs.bumpType ?? target.bumpType;
  target.releaseName = vs.releaseName ?? target.releaseName;
  target.releaseSlug = vs.releaseSlug ?? target.releaseSlug;
  target.releaseTheme = vs.releaseTheme ?? target.releaseTheme;
  target.releaseDate = vs.releaseDate ?? target.releaseDate;
  target.gitSha = vs.gitSha ?? target.gitSha;
  target.releases = (vs.releases || []).slice(-MAX_RELEASES);
  target.changelog = (vs.changelog || []).slice(-MAX_CHANGELOG_ENTRIES);
  target.breakingChanges = vs.breakingChanges ?? target.breakingChanges;
  target.migrationNotes = vs.migrationNotes ?? target.migrationNotes;
  target.sessionId = session;
  target.lastUpdated = new Date().toISOString();

  writeJson(versionPath, fullState);
}

function parseSemver(version) {
  const parts = (version || INITIAL_VERSION).split(".");
  return {
    major: parseInt(parts[0], 10) || 1,
    minor: parseInt(parts[1], 10) || 0,
    patch: parseInt(parts[2], 10) || 0,
  };
}

function bumpVersion(version, bumpType) {
  const v = parseSemver(version);
  switch (bumpType) {
    case "major":
      return `${v.major + 1}.0.0`;
    case "minor":
      return `${v.major}.${v.minor + 1}.0`;
    case "patch":
    default:
      return `${v.major}.${v.minor}.${v.patch + 1}`;
  }
}

function determineBumpType(changeTypes) {
  if (changeTypes.includes("breaking")) return "major";
  if (changeTypes.includes("feat") || changeTypes.includes("feature")) return "minor";
  return "patch";
}

function bumpProjectVersion(state, changeTypes, identityRootDir, sessionId) {
  const session = sessionId || getSessionId();
  const fullState = loadVersionState(session);
  const sessionState = fullState.sessions[session] || { ...DEFAULT_SESSION_VERSION };
  const previous = sessionState.current;
  const bumpType = determineBumpType(changeTypes || []);
  const newVersion = bumpVersion(previous, bumpType);
  const parsed = parseSemver(newVersion);
  const buildNumber = sessionState.buildNumber + 1;

  sessionState.previous = previous;
  sessionState.current = newVersion;
  sessionState.buildNumber = buildNumber;
  sessionState.bumpType = bumpType;
  sessionState.releaseDate = new Date().toISOString();
  sessionState.releaseTheme = getReleaseTheme(parsed.major);
  sessionState.releaseSlug = getReleaseSlug(newVersion);

  state.project.version = newVersion;
  state.project.buildNumber = buildNumber;
  state.versioning.current = newVersion;
  state.versioning.buildNumber = buildNumber;
  state.versioning.previous = previous;
  state.versioning.bumpType = bumpType;
  state.versioning.releaseName = `${newVersion} — ${getReleaseTheme(parsed.major)}`;
  state.versioning.releaseSlug = getReleaseSlug(newVersion);
  state.versioning.releaseTheme = getReleaseTheme(parsed.major);
  state.versioning.releaseDate = sessionState.releaseDate;

  saveVersionState(sessionState, session);

  if (identityRootDir) {
    const identity = loadProjectIdentity(identityRootDir);
    if (identity) {
      const description = changeTypes ? changeTypes.join(", ") : "";
      recordVersionBump(identity, { previous, current: newVersion, bumpType, buildNumber, changeTypes, description });
      saveProjectIdentity(identityRootDir, identity);
    }
  }

  return { previous, current: newVersion, buildNumber, bumpType };
}

function addChangelogEntry(state, entry, sessionId) {
  const session = sessionId || getSessionId();
  const fullState = loadVersionState(session);
  const sessionState = fullState.sessions[session] || { ...DEFAULT_SESSION_VERSION };
  const changelogEntry = {
    version: state.versioning.current,
    buildNumber: state.versioning.buildNumber,
    date: new Date().toISOString(),
    type: entry.type || "changed",
    scope: entry.scope || "",
    description: entry.description || "",
    author: "orchestra",
    sha: entry.sha || null,
  };
  sessionState.changelog.push(changelogEntry);
  if (sessionState.changelog.length > MAX_CHANGELOG_ENTRIES) {
    sessionState.changelog = sessionState.changelog.slice(-MAX_CHANGELOG_ENTRIES);
  }
  saveVersionState(sessionState, session);
  return changelogEntry;
}

function recordRelease(state, identityRootDir, sessionId) {
  const session = sessionId || getSessionId();
  const fullState = loadVersionState(session);
  const sessionState = fullState.sessions[session] || { ...DEFAULT_SESSION_VERSION };

  if (identityRootDir) {
    const identity = loadProjectIdentity(identityRootDir);
    if (identity) {
      saveProjectIdentity(identityRootDir, identity);
    }
  }

  const release = {
    version: state.versioning.current,
    buildNumber: state.versioning.buildNumber,
    name: state.versioning.releaseName,
    slug: state.versioning.releaseSlug,
    theme: state.versioning.releaseTheme,
    date: state.versioning.releaseDate,
    gitSha: state.versioning.gitSha,
    breakingChanges: [...(state.versioning.breakingChanges || [])],
    channel: state.project.releaseChannel || "development",
    changelogEntries: sessionState.changelog.filter((c) => c.version === state.versioning.current),
  };
  sessionState.releases.push(release);
  if (sessionState.releases.length > MAX_RELEASES) {
    sessionState.releases = sessionState.releases.slice(-MAX_RELEASES);
  }
  saveVersionState(sessionState, session);
  return release;
}

function generateChangelogMd(version, sessionId) {
  const session = sessionId || getSessionId();
  const fullState = loadVersionState(session);
  const sessionState = fullState.sessions[session] || { ...DEFAULT_SESSION_VERSION };
  const entries = version
    ? sessionState.changelog.filter((e) => e.version === version)
    : sessionState.changelog;
  if (entries.length === 0) return "## Changelog\n\nNo entries.";

  const byType = {};
  for (const e of entries) {
    if (!byType[e.type]) byType[e.type] = [];
    byType[e.type].push(e);
  }

  const typeOrder = [
    "added", "changed", "improved", "fixed", "deprecated", "removed",
    "security", "performance", "refactoring", "documentation", "tests", "infrastructure",
  ];
  const typeLabels = {
    added: "Added", changed: "Changed", improved: "Improved", fixed: "Fixed",
    deprecated: "Deprecated", removed: "Removed", security: "Security",
    performance: "Performance", refactoring: "Refactoring", documentation: "Documentation",
    tests: "Tests", infrastructure: "Infrastructure",
  };

  let md = `## Changelog${version ? ` (${version})` : ""}\n\n`;
  for (const t of typeOrder) {
    const items = byType[t];
    if (!items || items.length === 0) continue;
    md += `### ${typeLabels[t] || t}\n\n`;
    for (const item of items) {
      md += `- ${item.description}${item.scope ? ` (${item.scope})` : ""}\n`;
    }
    md += "\n";
  }
  return md;
}

function generateReleaseNotes(state, sessionId) {
  const session = sessionId || getSessionId();
  const fullState = loadVersionState(session);
  const sessionState = fullState.sessions[session] || { ...DEFAULT_SESSION_VERSION };
  const version = state.versioning;
  let notes = `# Release ${version.releaseName}\n\n`;
  notes += `- **Version:** ${version.current}\n`;
  notes += `- **Build:** ${version.buildNumber}\n`;
  notes += `- **Theme:** ${version.releaseTheme}\n`;
  notes += `- **Channel:** ${state.project.releaseChannel}\n`;
  notes += `- **Date:** ${version.releaseDate}\n`;
  notes += `- **Slug:** ${version.releaseSlug}\n\n`;

  if (version.breakingChanges && version.breakingChanges.length > 0) {
    notes += "## Breaking Changes\n\n";
    for (const bc of version.breakingChanges) {
      notes += `- ${bc}\n`;
    }
    notes += "\n";
  }

  if (version.migrationNotes && version.migrationNotes.length > 0) {
    notes += "## Migration Guide\n\n";
    for (const mn of version.migrationNotes) {
      notes += `- ${mn}\n`;
    }
    notes += "\n";
  }

  notes += generateChangelogMd(version.current, session);
  return notes;
}

function getSessionVersionState(versionState, sessionId) {
  const session = sessionId || getSessionId();
  if (!versionState.sessions) return { ...DEFAULT_SESSION_VERSION };
  return versionState.sessions[session] || { ...DEFAULT_SESSION_VERSION };
}

function getAggregatedVersionState(versionState) {
  if (!versionState.sessions) return { ...DEFAULT_SESSION_VERSION };

  const aggregated = { ...DEFAULT_SESSION_VERSION };
  for (const [, sessionVer] of Object.entries(versionState.sessions)) {
    if (!sessionVer) continue;
    aggregated.releases.push(...(sessionVer.releases || []));
    aggregated.changelog.push(...(sessionVer.changelog || []));
    aggregated.breakingChanges.push(...(sessionVer.breakingChanges || []));
    aggregated.migrationNotes.push(...(sessionVer.migrationNotes || []));
  }
  aggregated.releases.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  aggregated.changelog.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  if (aggregated.releases.length > MAX_RELEASES) {
    aggregated.releases = aggregated.releases.slice(-MAX_RELEASES);
  }
  if (aggregated.changelog.length > MAX_CHANGELOG_ENTRIES) {
    aggregated.changelog = aggregated.changelog.slice(-MAX_CHANGELOG_ENTRIES);
  }
  return aggregated;
}

module.exports = {
  VERSION_PATH,
  DEFAULT_SESSION_VERSION,
  DEFAULT_VERSION_STATE,
  getSessionId,
  loadVersionState,
  saveVersionState,
  parseSemver,
  bumpVersion,
  determineBumpType,
  bumpProjectVersion,
  addChangelogEntry,
  recordRelease,
  generateChangelogMd,
  generateReleaseNotes,
  RELEASE_THEMES,
  getSessionVersionState,
  getAggregatedVersionState,
  migrateToSessions,
  atomicWrite,
};
