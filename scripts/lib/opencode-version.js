/**
 * OpenCode CLI version detection and feature gates.
 */
"use strict";

const { execSync } = require("child_process");

/** First stable release expected to accept tool_output in opencode.json (schema preview). */
const MIN_TOOL_OUTPUT_VERSION = "1.19.0";

function parseVersion(raw) {
  if (!raw || typeof raw !== "string") return null;
  const m = raw.trim().match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

function compareSemver(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  const sa = pa.split(".").map(Number);
  const sb = pb.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (sa[i] || 0) - (sb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

function getOpenCodeVersion() {
  try {
    const out = execSync("opencode --version 2>/dev/null", {
      encoding: "utf8",
      timeout: 8000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseVersion(out);
  } catch {
    return null;
  }
}

function supportsToolOutput(version = getOpenCodeVersion()) {
  if (!version) return false;
  const cmp = compareSemver(version, MIN_TOOL_OUTPUT_VERSION);
  return cmp !== null && cmp >= 0;
}

module.exports = {
  MIN_TOOL_OUTPUT_VERSION,
  parseVersion,
  compareSemver,
  getOpenCodeVersion,
  supportsToolOutput,
};
