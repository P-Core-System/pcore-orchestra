/**
 * Read-only data layer for conductor-runs
 * Consumes conductor-runs index and detail JSON files
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type {
  RunEntry,
  RunDetail,
  RunPhase,
  RunGate,
  RunEvidence,
  RunHandoff,
  RunTokens,
  StateDirInfo,
} from './types';

const DEFAULT_STATE_DIR = path.join(os.homedir(), '.config', 'opencode', 'hooks', 'state');

function getEnvStateDir(): string {
  return process.env.PCORE_STATE_DIR || DEFAULT_STATE_DIR;
}

function resolveConductorRunsDir(stateDir: string): string {
  return path.join(stateDir, 'conductor-runs');
}

function resolveWorktreeConductorRunsDir(worktreePath: string): string {
  return path.join(worktreePath, '.pcore', 'state', 'conductor-runs');
}

export function resolveStateDirs(worktreePath?: string): StateDirInfo[] {
  const dirs: StateDirInfo[] = [];

  // Global state dir
  const globalStateDir = getEnvStateDir();
  const globalRunsDir = resolveConductorRunsDir(globalStateDir);
  if (fs.existsSync(globalRunsDir)) {
    dirs.push({ path: globalRunsDir, isWorktree: false });
  }

  // Worktree state dir
  if (worktreePath) {
    const wtRunsDir = resolveWorktreeConductorRunsDir(worktreePath);
    if (fs.existsSync(wtRunsDir)) {
      dirs.push({ path: wtRunsDir, isWorktree: true });
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

function loadIndexFromDir(runsDir: string): RunEntry[] {
  const indexPath = path.join(runsDir, 'index.json');
  const index = readJsonSafe<{ version: number; updated_at: number; runs: Record<string, RunEntry> }>(indexPath);
  if (!index || !index.runs) return [];
  return Object.values(index.runs);
}

export function loadIndex(stateDir?: string): RunEntry[] {
  const targetDir = stateDir || getEnvStateDir();
  const runsDir = resolveConductorRunsDir(targetDir);
  return loadIndexFromDir(runsDir);
}

export function loadRun(runId: string, stateDir?: string): RunDetail | null {
  const targetDir = stateDir || getEnvStateDir();
  const runsDir = resolveConductorRunsDir(targetDir);

  // Find the run file by key pattern: <ws>/<sid>/<tid>
  const indexPath = path.join(runsDir, 'index.json');
  const index = readJsonSafe<{ runs: Record<string, RunEntry> }>(indexPath);
  if (!index || !index.runs) return null;

  const entry = Object.values(index.runs).find((r) => r.runId === runId);
  if (!entry) return null;

  const runPath = path.join(runsDir, entry.workspace, entry.sessionId, `${entry.taskId}.json`);
  const runDetail = readJsonSafe<RunDetail>(runPath);
  return runDetail;
}

export function listRuns(stateDir?: string): RunEntry[] {
  return loadIndex(stateDir);
}

export function findRunByKey(key: string, stateDir?: string): RunDetail | null {
  const targetDir = stateDir || getEnvStateDir();
  const runsDir = resolveConductorRunsDir(targetDir);

  const runPath = path.join(runsDir, `${key}.json`);
  if (!fs.existsSync(runPath)) {
    // Try with workspace/session/task structure
    const parts = key.split('/');
    if (parts.length === 3) {
      const [ws, sid, tid] = parts;
      const altPath = path.join(runsDir, ws, sid, `${tid}.json`);
      if (fs.existsSync(altPath)) {
        return readJsonSafe<RunDetail>(altPath);
      }
    }
    return null;
  }

  return readJsonSafe<RunDetail>(runPath);
}

export function getRunPhases(runDetail: RunDetail): RunPhase[] {
  return runDetail.phases || [];
}

export function getRunGates(runDetail: RunDetail): RunGate[] {
  return runDetail.gates || [];
}

export function getRunEvidence(runDetail: RunDetail): RunEvidence[] {
  return runDetail.evidence || [];
}

export function getRunHandoff(runDetail: RunDetail): RunHandoff | undefined {
  return runDetail.handoff;
}

export function getRunTokens(runDetail: RunDetail): RunTokens | undefined {
  return runDetail.tokens;
}

export function getRunStatus(runDetail: RunDetail): RunEntry['status'] {
  return runDetail.status;
}

export function isRunStalled(runDetail: RunDetail, thresholdMs = 600000): boolean {
  if (runDetail.status !== 'in_progress') return false;
  const now = Date.now();
  return now - runDetail.updatedAt > thresholdMs;
}

export function computeRunDuration(runDetail: RunDetail): number {
  if (runDetail.durationMs) return runDetail.durationMs;
  if (runDetail.status === 'completed' && runDetail.updatedAt) {
    return runDetail.updatedAt - runDetail.startedAt;
  }
  return Date.now() - runDetail.startedAt;
}