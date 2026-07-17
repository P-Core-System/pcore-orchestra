"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { INITIAL_VERSION, INITIAL_BUILD, MAX_RELEASES, MAX_CHANGELOG_ENTRIES } = require("./constants.js");

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

const DEFAULT_VERSION_STATE = {
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

function loadVersionState() {
  try {
    if (!fs.existsSync(VERSION_PATH)) return { ...DEFAULT_VERSION_STATE };
    const raw = JSON.parse(fs.readFileSync(VERSION_PATH, "utf8"));
    return { ...DEFAULT_VERSION_STATE, ...raw,
      releases: raw.releases || [],
      changelog: raw.changelog || [],
    };
  } catch {
    return { ...DEFAULT_VERSION_STATE };
  }
}

function saveVersionState(vs) {
  fs.mkdirSync(path.dirname(VERSION_PATH), { recursive: true });
  fs.writeFileSync(VERSION_PATH, JSON.stringify(vs, null, 2));
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

function bumpProjectVersion(state, changeTypes) {
  const vs = loadVersionState();
  const previous = vs.current;
  const bumpType = determineBumpType(changeTypes || []);
  const newVersion = bumpVersion(previous, bumpType);
  const parsed = parseSemver(newVersion);
  const buildNumber = vs.buildNumber + 1;

  vs.previous = previous;
  vs.current = newVersion;
  vs.buildNumber = buildNumber;
  vs.bumpType = bumpType;
  vs.releaseDate = new Date().toISOString();
  vs.releaseTheme = getReleaseTheme(parsed.major);
  vs.releaseSlug = getReleaseSlug(newVersion);

  state.project.version = newVersion;
  state.project.buildNumber = buildNumber;
  state.versioning.current = newVersion;
  state.versioning.buildNumber = buildNumber;
  state.versioning.previous = previous;
  state.versioning.bumpType = bumpType;
  state.versioning.releaseName = `${newVersion} — ${getReleaseTheme(parsed.major)}`;
  state.versioning.releaseSlug = getReleaseSlug(newVersion);
  state.versioning.releaseTheme = getReleaseTheme(parsed.major);
  state.versioning.releaseDate = vs.releaseDate;

  saveVersionState(vs);
  return { previous, current: newVersion, buildNumber, bumpType };
}

function addChangelogEntry(state, entry) {
  const vs = loadVersionState();
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
  vs.changelog.push(changelogEntry);
  if (vs.changelog.length > MAX_CHANGELOG_ENTRIES) {
    vs.changelog = vs.changelog.slice(-MAX_CHANGELOG_ENTRIES);
  }
  saveVersionState(vs);
  return changelogEntry;
}

function recordRelease(state) {
  const vs = loadVersionState();
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
    changelogEntries: vs.changelog.filter(c => c.version === state.versioning.current),
  };
  vs.releases.push(release);
  if (vs.releases.length > MAX_RELEASES) {
    vs.releases = vs.releases.slice(-MAX_RELEASES);
  }
  saveVersionState(vs);
  return release;
}

function generateChangelogMd(version) {
  const vs = loadVersionState();
  const entries = version
    ? vs.changelog.filter(e => e.version === version)
    : vs.changelog;
  if (entries.length === 0) return "## Changelog\n\nNo entries.";

  const byType = {};
  for (const e of entries) {
    if (!byType[e.type]) byType[e.type] = [];
    byType[e.type].push(e);
  }

  const typeOrder = ["added", "changed", "improved", "fixed", "deprecated", "removed", "security", "performance", "refactoring", "documentation", "tests", "infrastructure"];
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

function generateReleaseNotes(state) {
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

  notes += generateChangelogMd(version.current);
  return notes;
}

module.exports = {
  VERSION_PATH,
  DEFAULT_VERSION_STATE,
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
};
