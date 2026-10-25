"use strict";

/**
 * State directory discovery for Studio v2 server.
 * Sole owner of state-dir discovery (the old client-side
 * studio/src/lib/stateResolver.ts was deleted; served via /api/state-dirs).
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execSync } = require("child_process");

/** Relative segments of the default global state dir under the user's home. */
const GLOBAL_STATE_SEGMENTS = [".config", "opencode", "hooks", "state"];

/**
 * Canonicalise a state dir path (Windows/WSL path portability).
 *
 * `path.resolve`/`normalize` are used rather than string concatenation so a
 * drive letter is never glued to a `/` (`C:\Users\x` + `/...` -> `C:\Users\x/...`),
 * and mixed separators collapse to the host's. `path.win32` handles `C:\...`
 * and UNC (\server\share), `path.posix` handles `/mnt/c/Users/x`.
 */
function canonicalStateDir(value) {
  if (typeof value !== "string" || value.length === 0) return "";
  try {
    // Drive-letter and UNC paths keep Windows semantics even when a POSIX host
    // (WSL) reads them; everything else follows the running host.
    const isWindowsStyle = /^[a-zA-Z]:[\\/]/.test(value) || /^[\\/]{2}[^\\/]/.test(value);
    return path.normalize(isWindowsStyle ? path.win32.resolve(value) : path.resolve(value));
  } catch {
    return value;
  }
}

/**
 * Home directory resolution order: `HOME` -> `USERPROFILE` -> `os.homedir()`.
 * (`os.homedir()` alone returns the wrong profile under some Windows shells
 * where HOME is unset but USERPROFILE is authoritative.)
 */
function homeDir() {
  const fromEnv = process.env.HOME || process.env.USERPROFILE;
  if (typeof fromEnv === "string" && fromEnv.length > 0) return canonicalStateDir(fromEnv);
  try {
    return canonicalStateDir(os.homedir());
  } catch {
    return "";
  }
}

/** Default global state dir: `PCORE_STATE_DIR`, else `~/.config/opencode/hooks/state`. */
function defaultStateDir() {
  if (process.env.PCORE_STATE_DIR) return canonicalStateDir(process.env.PCORE_STATE_DIR);
  const home = homeDir();
  return home ? canonicalStateDir(path.join(home, ...GLOBAL_STATE_SEGMENTS)) : "";
}

function getEnvStateDir() {
  return defaultStateDir();
}

function parseGitWorktrees() {
  try {
    const output = execSync("git worktree list --porcelain", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    const worktrees = [];
    const lines = output.trim().split("\n");

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        const worktreePath = line.slice("worktree ".length).trim();
        if (worktreePath !== process.cwd()) {
          worktrees.push(worktreePath);
        }
      }
    }

    return worktrees;
  } catch {
    return [];
  }
}

function getWorktreeStateDir(worktreePath) {
  return path.join(worktreePath, ".pcore", "state");
}

function getRunIdFromWorktree(worktreePath) {
  const match = worktreePath.match(/\.pcore[\\/]worktrees[\\/]([^\\/]+)/);
  if (match) return match[1];
  return undefined;
}

function discoverStateDirs() {
  const dirs = [];

  // Global state dir
  const globalStateDir = getEnvStateDir();
  if (fs.existsSync(globalStateDir)) {
    dirs.push({ path: globalStateDir, isWorktree: false });
  }

  // Worktree state dirs
  const worktreePaths = parseGitWorktrees();
  for (const wtPath of worktreePaths) {
    const wtStateDir = canonicalStateDir(getWorktreeStateDir(wtPath));
    if (fs.existsSync(wtStateDir)) {
      dirs.push({
        path: wtStateDir,
        isWorktree: true,
        runId: getRunIdFromWorktree(wtPath),
      });
    }
  }

  return dirs;
}

module.exports = { discoverStateDirs, getEnvStateDir };
