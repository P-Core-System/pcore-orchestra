/**
 * Worktree-aware state directory discovery
 * Discovers global and worktree-partitioned state directories for Studio
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import type { StateDirInfo } from './types';

const DEFAULT_STATE_DIR = path.join(os.homedir(), '.config', 'opencode', 'hooks', 'state');
// Default global state dir: .config/opencode/hooks/state

function getEnvStateDir(): string {
  return process.env.PCORE_STATE_DIR || DEFAULT_STATE_DIR;
}

function parseGitWorktrees(): string[] {
  try {
    const output = execSync('git worktree list --porcelain', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    const worktrees: string[] = [];
    const lines = output.trim().split('\n');

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        const worktreePath = line.slice('worktree '.length).trim();
        // Skip the main worktree (first one)
        if (worktreePath !== process.cwd()) {
          worktrees.push(worktreePath);
        }
      }
    }

    return worktrees;
  } catch {
    // git not available, not a repo, or no worktrees
    return [];
  }
}

function getWorktreeStateDir(worktreePath: string): string {
  // Worktree state dir pattern: .pcore/state
  return path.join(worktreePath, '.pcore', 'state');
}

function getRunIdFromWorktree(worktreePath: string): string | undefined {
  // Try to extract runId from worktree path pattern: .pcore/worktrees/<runId>/
  const match = worktreePath.match(/\.pcore[\\/]worktrees[\\/]([^\\/]+)/);
  if (match) {
    return match[1];
  }
  return undefined;
}

export function discoverStateDirs(): StateDirInfo[] {
  const dirs: StateDirInfo[] = [];

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

export function getGlobalStateDir(): string {
  return getEnvStateDir();
}

export function getWorktreeStateDirs(): StateDirInfo[] {
  const dirs: StateDirInfo[] = [];
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

export function resolveStateDirForRun(runId: string, stateDirs: StateDirInfo[]): string | undefined {
  // First check worktrees for matching runId
  for (const dir of stateDirs) {
    if (dir.isWorktree && dir.runId === runId) {
      return dir.path;
    }
  }
  // Fall back to global
  const global = stateDirs.find((d) => !d.isWorktree);
  return global?.path;
}

export { StateDirInfo } from './types';