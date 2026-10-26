"use strict";

const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

/** Files that may remain dirty without blocking phase advance (plans are gitignored). */
const ALLOWED_DIRTY = [
  /^\.cursor\/orchestra-plan\.md$/,
  /^orchestra-plan\.md$/,
];

function runGit(args, cwd) {
  const r = spawnSync("git", args, {
    cwd: cwd || process.cwd(),
    encoding: "utf8",
    timeout: 15000,
  });
  return {
    ok: r.status === 0,
    stdout: (r.stdout || "").trim(),
    stderr: (r.stderr || "").trim(),
    spawnError: r.error || null,
  };
}

function detectRepoRoot(state) {
  if (state?.project?.identityFile) {
    return path.dirname(state.project.identityFile);
  }
  return process.cwd();
}

function porcelainLines(cwd) {
  const dir = cwd || process.cwd();
  const r = runGit(["status", "--porcelain"], dir);
  if (!r.ok) {
    const detail = [r.stderr, r.stdout, r.spawnError && r.spawnError.message]
      .filter(Boolean)
      .join(" — ");
    // A missing working directory is the same as having no repo to gate.
    if (!fs.existsSync(dir)) {
      return { ok: false, lines: [], error: detail || "cwd does not exist", notGitRepo: true };
    }
    // Git ran but errored (ownership, lock, corrupt index) -> tool error, fail closed.
    if (!/not a git repository/i.test(detail)) {
      return { ok: false, lines: [], error: detail || "git status failed", gitError: true };
    }
    return { ok: false, lines: [], error: detail, notGitRepo: true };
  }
  const lines = r.stdout ? r.stdout.split("\n").filter(Boolean) : [];
  return { ok: true, lines };
}

function isAllowedDirty(filePath) {
  const norm = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  return ALLOWED_DIRTY.some((re) => re.test(norm));
}

/**
 * Check working tree before advancing to next phase.
 * @returns {{ clean: boolean, blocking: string[], allowed: string[], message: string }}
 */
function checkPhaseCommitGate(state, options = {}) {
  const cwd = options.cwd || detectRepoRoot(state);
  const { ok, lines, error, gitError, notGitRepo } = porcelainLines(cwd);
  if (!ok) {
    if (gitError) {
      // Git repo exists but status failed -> fail closed (invariant 24)
      return {
        clean: false,
        blocking: ["!! git-error: git status unavailable inside repository — " + (error || "unknown")],
        allowed: [],
        message: "Phase commit gate FAIL — git-error: git status unavailable inside repository (" + (error || "unknown") + "). Fail closed per invariant 24.",
        skipped: false,
        gitError: true,
      };
    }
    // Not a git repo -> skip (skip-no-git)
    return {
      clean: true,
      blocking: [],
      allowed: [],
      message: "Phase commit gate SKIPPED — not a git repository; no commit gate possible.",
      skipped: true,
      notGitRepo: true,
    };
  }

  const blocking = [];
  const allowed = [];
  for (const line of lines) {
    const file = line.slice(3).trim().split(" -> ").pop();
    if (isAllowedDirty(file)) allowed.push(file);
    else blocking.push(`${line.slice(0, 2)} ${file}`);
  }

  const clean = blocking.length === 0;
  let message;
  if (clean) {
    message =
      allowed.length > 0
        ? `Phase commit gate PASS (only allowed dirty: ${allowed.join(", ")}).`
        : "Phase commit gate PASS — working tree clean. Safe to launch next phase.";
  } else {
    message = [
      "Phase commit gate FAIL — uncommitted changes block next phase:",
      ...blocking.slice(0, 15).map((b) => `  ${b}`),
      "Commit (or discard) before launching the next orchestra-* subagent.",
      "Convention: <type>(<scope>): <description>",
    ].join("\n");
  }

  return { clean, blocking, allowed, message, skipped: false };
}

function buildCommitGateHandoff(state, nextAgentId, options = {}) {
  const gate = checkPhaseCommitGate(state, options);
  const lines = [
    "Phase-boundary git rule:",
    "- Each phase that changes files MUST commit before the next phase starts.",
    "- Parent: do NOT launch next subagent until git status is clean (except .cursor/orchestra-plan.md).",
    "- Implementer commits code; parent may commit docs/progress-tracker after review if dirty.",
  ];

  if (nextAgentId === "orchestra-verifier" || nextAgentId === "orchestra-reviewer") {
    lines.push(
      gate.skipped
        ? "Commit gate SKIPPED (git status unavailable) — verify the working tree is clean manually before launching this phase."
        : gate.message
    );
  } else if (nextAgentId === "orchestra-implementer") {
    lines.push(
      "After IMPLEMENT_DONE: commit ALL plan files before verifier. No uncommitted code into verify."
    );
  }

  return lines.join("\n");
}

module.exports = {
  ALLOWED_DIRTY,
  checkPhaseCommitGate,
  buildCommitGateHandoff,
  detectRepoRoot,
  porcelainLines,
};
