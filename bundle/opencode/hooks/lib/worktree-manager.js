"use strict";

/**
 * Git worktree manager for per-run isolation.
 *
 * Each orchestra run gets its own git worktree at `.pcore/worktrees/<runId>/`
 * checked out at the base commit. This provides complete filesystem isolation
 * between concurrent runs — each run has its own working directory, its own
 * `.pcore/state/` for domain events, conductor runs, and review queues.
 *
 * The worktree is created at run start and cleaned up at run end.
 */

const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");

/** Base directory for worktrees within a project. */
function getWorktreesBaseDir(projectRoot) {
  return path.join(projectRoot, ".pcore", "worktrees");
}

/** Resolve the project root (workspace root). */
function resolveProjectRoot(cwd) {
  return process.env.PCORE_WORKSPACE_ROOT || cwd || process.cwd() || process.env.PWD;
}

/** Run `git worktree add` to create a new worktree. */
function gitWorktreeAdd(worktreePath, commit) {
  const projectRoot = path.resolve(worktreePath, "..", "..", "..");
  const r = cp.spawnSync("git", ["worktree", "add", "--detach", worktreePath, commit], {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 30000,
  });
  if (r.status !== 0) {
    throw new Error(`git worktree add failed: ${r.stderr || r.stdout || "unknown error"}`);
  }
}

/** Run `git worktree remove` to remove a worktree. */
function gitWorktreeRemove(worktreePath) {
  const projectRoot = path.resolve(worktreePath, "..", "..", "..");
  const r = cp.spawnSync("git", ["worktree", "remove", "--force", worktreePath], {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 10000,
  });
  // Non-zero exit is ok if worktree was already removed
  return r.status === 0;
}

/** Run `git worktree prune` to clean up stale worktree entries. */
function gitWorktreePrune(projectRoot) {
  cp.spawnSync("git", ["worktree", "prune"], {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 10000,
  });
}

/** Get the list of worktrees from `git worktree list --porcelain`. */
function getWorktreeList(projectRoot) {
  const r = cp.spawnSync("git", ["worktree", "list", "--porcelain"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (r.status !== 0) return [];
  const output = r.stdout.trim();
  if (!output) return [];
  
  const worktrees = [];
  let current = {};
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current.path) worktrees.push(current);
      current = { path: line.slice(9).trim() };
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice(5).trim();
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice(7).trim();
    } else if (line === "detached") {
      current.detached = true;
    } else if (line === "bare") {
      current.bare = true;
    }
  }
  if (current.path) worktrees.push(current);
  return worktrees;
}

/**
 * Create a new git worktree for a run.
 * @param {string} runId - unique run identifier
 * @param {string} baseCommit - commit SHA to checkout
 * @param {string} [projectRoot] - project root (defaults to cwd)
 * @returns {{worktreePath: string, runId: string, baseCommit: string}}
 */
function createRunWorktree(runId, baseCommit, projectRoot) {
  const root = resolveProjectRoot(projectRoot);
  const worktreesDir = getWorktreesBaseDir(root);
  const worktreePath = path.join(worktreesDir, runId);
  
  // Ensure worktrees base dir exists
  fs.mkdirSync(worktreesDir, { recursive: true });
  
  // Check if worktree already exists
  if (fs.existsSync(worktreePath)) {
    // Verify it's at the right commit
    const head = cp.spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: worktreePath,
      encoding: "utf8",
    }).stdout.trim();
    if (head === baseCommit) {
      return { worktreePath, runId, baseCommit };
    }
    // Wrong commit - remove and recreate
    gitWorktreeRemove(worktreePath);
  }
  
  // Create the worktree
  gitWorktreeAdd(worktreePath, baseCommit);
  
  // Ensure .pcore/state directory exists in the worktree
  const stateDir = path.join(worktreePath, ".pcore", "state");
  fs.mkdirSync(stateDir, { recursive: true });
  
  // Ensure conductor-runs directory exists
  const conductorDir = path.join(stateDir, "conductor-runs");
  fs.mkdirSync(conductorDir, { recursive: true });
  
  return { worktreePath, runId, baseCommit };
}

/**
 * Clean up a run's worktree.
 * @param {string} runId - run identifier
 * @param {string} [projectRoot] - project root (defaults to cwd)
 */
function cleanupRunWorktree(runId, projectRoot) {
  const root = resolveProjectRoot(projectRoot);
  const worktreePath = path.join(getWorktreesBaseDir(root), runId);
  
  if (fs.existsSync(worktreePath)) {
    gitWorktreeRemove(worktreePath);
  }
  
  // Prune any stale entries
  gitWorktreePrune(root);
}

/**
 * Get the worktree path for a run.
 * @param {string} runId - run identifier
 * @param {string} [projectRoot] - project root (defaults to cwd)
 * @returns {string|null} worktree path or null if not found
 */
function getWorktreePath(runId, projectRoot) {
  const root = resolveProjectRoot(projectRoot);
  const worktreePath = path.join(getWorktreesBaseDir(root), runId);
  return fs.existsSync(worktreePath) ? worktreePath : null;
}

/**
 * List all active run worktrees.
 * @param {string} [projectRoot] - project root (defaults to cwd)
 * @returns {Array<{runId: string, worktreePath: string, head: string}>}
 */
function listRunWorktrees(projectRoot) {
  const root = resolveProjectRoot(projectRoot);
  const worktreesDir = getWorktreesBaseDir(root);
  
  if (!fs.existsSync(worktreesDir)) return [];
  
  const entries = fs.readdirSync(worktreesDir, { withFileTypes: true });
  const worktrees = [];
  
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runId = entry.name;
    const worktreePath = path.join(worktreesDir, runId);
    
    // Verify it's a valid git worktree
    const head = cp.spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: worktreePath,
      encoding: "utf8",
    }).stdout.trim();
    
    if (head && /^[0-9a-f]{40}$/i.test(head)) {
      worktrees.push({ runId, worktreePath, head });
    }
  }
  
  return worktrees;
}

module.exports = {
  getWorktreesBaseDir,
  resolveProjectRoot,
  createRunWorktree,
  cleanupRunWorktree,
  getWorktreePath,
  listRunWorktrees,
};