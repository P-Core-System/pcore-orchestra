/**
 * Read-only data layer for orchestra-tokens
 * Parses orchestra-tokens.json and computes aggregates
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type {
  TokenState,
  AgentTokens,
  PhaseTokens,
  RunTokens,
  StateDirInfo,
} from './types';

export type {
  TokenState,
  AgentTokens,
  PhaseTokens,
  RunTokens,
} from './types';

const DEFAULT_STATE_DIR = path.join(os.homedir(), '.config', 'opencode', 'hooks', 'state');

function getEnvStateDir(): string {
  return process.env.PCORE_STATE_DIR || DEFAULT_STATE_DIR;
}

function resolveTokensPath(stateDir: string): string {
  return path.join(stateDir, 'orchestra-tokens.json');
}

function resolveWorktreeTokensPath(worktreePath: string): string {
  return path.join(worktreePath, '.pcore', 'state', 'orchestra-tokens.json');
}

export function resolveTokensPaths(worktreePath?: string): StateDirInfo[] {
  const dirs: StateDirInfo[] = [];

  const globalStateDir = getEnvStateDir();
  const globalTokensPath = resolveTokensPath(globalStateDir);
  if (fs.existsSync(globalTokensPath)) {
    dirs.push({ path: globalTokensPath, isWorktree: false });
  }

  if (worktreePath) {
    const wtTokensPath = resolveWorktreeTokensPath(worktreePath);
    if (fs.existsSync(wtTokensPath)) {
      dirs.push({ path: wtTokensPath, isWorktree: true });
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

export function loadTokenState(stateDir?: string): TokenState | null {
  const targetDir = stateDir || getEnvStateDir();
  const tokensPath = resolveTokensPath(targetDir);
  return readJsonSafe<TokenState>(tokensPath);
}

export function loadTokenStateFromPath(tokensPath: string): TokenState | null {
  return readJsonSafe<TokenState>(tokensPath);
}

function computeAgentTokens(runs: RunTokens[]): AgentTokens[] {
  const agentMap = new Map<string, { total: number; count: number; budgets: number[] }>();

  for (const run of runs) {
    for (const agentToken of run.byAgent) {
      const existing = agentMap.get(agentToken.agent) || { total: 0, count: 0, budgets: [] };
      existing.total += agentToken.total;
      existing.count += 1;
      existing.budgets.push(agentToken.budget);
      agentMap.set(agentToken.agent, existing);
    }
  }

  return Array.from(agentMap.entries()).map(([agent, data]) => ({
    agent,
    total: data.total,
    average: data.count > 0 ? Math.round(data.total / data.count) : 0,
    budget: data.budgets.length > 0 ? Math.round(data.budgets.reduce((a, b) => a + b, 0) / data.budgets.length) : 0,
    overBudget: data.total > data.budgets.reduce((a, b) => a + b, 0),
    runs: data.count,
  }));
}

function computePhaseTokens(runs: RunTokens[]): PhaseTokens[] {
  const phaseMap = new Map<string, { total: number; count: number; budgets: number[] }>();

  for (const run of runs) {
    for (const phaseToken of run.byPhase) {
      const existing = phaseMap.get(phaseToken.phase) || { total: 0, count: 0, budgets: [] };
      existing.total += phaseToken.total;
      existing.count += 1;
      existing.budgets.push(phaseToken.budget);
      phaseMap.set(phaseToken.phase, existing);
    }
  }

  return Array.from(phaseMap.entries()).map(([phase, data]) => ({
    phase,
    total: data.total,
    average: data.count > 0 ? Math.round(data.total / data.count) : 0,
    budget: data.budgets.length > 0 ? Math.round(data.budgets.reduce((a, b) => a + b, 0) / data.budgets.length) : 0,
    runs: data.count,
  }));
}

function computeTrend(runs: RunTokens[], limit = 20): RunTokens[] {
  return runs.slice(-limit).sort((a, b) => a.timestamp - b.timestamp);
}

export function getAggregatedTokens(stateDir?: string): {
  byAgent: AgentTokens[];
  byPhase: PhaseTokens[];
  byRun: RunTokens[];
  trend: RunTokens[];
} | null {
  const tokenState = loadTokenState(stateDir);
  if (!tokenState || !tokenState.runs) return null;

  const runs = tokenState.runs;
  return {
    byAgent: computeAgentTokens(runs),
    byPhase: computePhaseTokens(runs),
    byRun: runs,
    trend: computeTrend(runs),
  };
}

export function getSessionTokens(sessionId: string, stateDir?: string): RunTokens[] {
  const tokenState = loadTokenState(stateDir);
  if (!tokenState || !tokenState.runs) return [];
  return tokenState.runs.filter((r) => r.runId.includes(sessionId));
}

export function getRunTokens(runId: string, stateDir?: string): RunTokens | null {
  const tokenState = loadTokenState(stateDir);
  if (!tokenState || !tokenState.runs) return null;
  return tokenState.runs.find((r) => r.runId === runId) || null;
}

export function getOverBudgetAgents(stateDir?: string): AgentTokens[] {
  const aggregated = getAggregatedTokens(stateDir);
  if (!aggregated) return [];
  return aggregated.byAgent.filter((a) => a.overBudget);
}

export function getPhasesExceedingEstimate(stateDir?: string): PhaseTokens[] {
  const aggregated = getAggregatedTokens(stateDir);
  if (!aggregated) return [];
  return aggregated.byPhase.filter((p) => p.total > p.budget * p.runs);
}

export function getTokenTrend(stateDir?: string, limit = 20): RunTokens[] {
  const aggregated = getAggregatedTokens(stateDir);
  if (!aggregated) return [];
  return aggregated.trend.slice(-limit);
}