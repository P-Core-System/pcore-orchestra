/**
 * Read-only data layer for orchestra-history
 * Parses orchestra-history.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type {
  CycleReport,
  CyclePhase,
  StateDirInfo,
} from './types';

export type {
  CycleReport,
  CyclePhase,
} from './types';

const DEFAULT_STATE_DIR = path.join(os.homedir(), '.config', 'opencode', 'hooks', 'state');

function getEnvStateDir(): string {
  return process.env.PCORE_STATE_DIR || DEFAULT_STATE_DIR;
}

function resolveHistoryPath(stateDir: string): string {
  return path.join(stateDir, 'orchestra-history.json');
}

function resolveWorktreeHistoryPath(worktreePath: string): string {
  return path.join(worktreePath, '.pcore', 'state', 'orchestra-history.json');
}

export function resolveHistoryPaths(worktreePath?: string): StateDirInfo[] {
  const dirs: StateDirInfo[] = [];

  const globalStateDir = getEnvStateDir();
  const globalHistoryPath = resolveHistoryPath(globalStateDir);
  if (fs.existsSync(globalHistoryPath)) {
    dirs.push({ path: globalHistoryPath, isWorktree: false });
  }

  if (worktreePath) {
    const wtHistoryPath = resolveWorktreeHistoryPath(worktreePath);
    if (fs.existsSync(wtHistoryPath)) {
      dirs.push({ path: wtHistoryPath, isWorktree: true });
    }
  }

  return dirs;
}

function readJsonSafe<T>(filePath: string): T | null {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export function loadHistory(stateDir?: string): CycleReport[] {
  const targetDir = stateDir || getEnvStateDir();
  const historyPath = resolveHistoryPath(targetDir);
  const history = readJsonSafe<CycleReport[]>(historyPath);
  return history || [];
}

export function loadHistoryFromPath(historyPath: string): CycleReport[] {
  const history = readJsonSafe<CycleReport[]>(historyPath);
  return history || [];
}

export function getRecentRuns(limit: number, stateDir?: string): CycleReport[] {
  const history = loadHistory(stateDir);
  return history
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, limit);
}

export function getRunById(runId: string, stateDir?: string): CycleReport | null {
  const history = loadHistory(stateDir);
  return history.find((r) => r.runId === runId) || null;
}

export function getRunByRunId(runId: string, stateDir?: string): CycleReport | null {
  return getRunById(runId, stateDir);
}

export function getPhasesForRun(runId: string, stateDir?: string): CyclePhase[] {
  const run = getRunById(runId, stateDir);
  return run?.phases || [];
}

export function getCompletedRuns(stateDir?: string): CycleReport[] {
  const history = loadHistory(stateDir);
  return history.filter((r) => r.status === 'completed');
}

export function getFailedRuns(stateDir?: string): CycleReport[] {
  const history = loadHistory(stateDir);
  return history.filter((r) => r.status === 'failed');
}