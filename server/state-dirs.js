"use strict";

/**
 * State directory discovery for Studio v2 server.
 * Mirrors studio/src/lib/stateResolver.ts logic but runs server-side.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execSync } = require("child_process");

const DEFAULT_STATE_DIR = path.join(os.homedir(), ".config", "opencode", "hooks", "state");

function getEnvStateDir() {
  return process.env.PCORE_STATE_DIR || DEFAULT_STATE_DIR;
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
    const wtStateDir = getWorktreeStateDir(wtPath);
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
