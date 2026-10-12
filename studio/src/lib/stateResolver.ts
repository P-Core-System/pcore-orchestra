/**
 * Worktree-aware state directory discovery
 * Discovers global and worktree-partitioned state directories for Studio
 *
 * Browser safety (architecture invariants 35/36): the SPA never touches the
 * filesystem — `StateContext` loads dirs from `GET /api/state-dirs` and this
 * module's `discoverStateDirs()` is only a local fallback. Node built-ins are
 * therefore resolved lazily behind a `typeof window` guard and every call is
 * wrapped in try/catch, so importing this module in a browser bundle can never
 * throw at module scope (the previous top-level `os.homedir()` call crashed the
 * bundle and left a white screen).
 */

import type { StateDirInfo } from './types';

// Default global state dir: .config/opencode/hooks/state
const GLOBAL_STATE_SEGMENTS = ['.config', 'opencode', 'hooks', 'state'];
// Worktree state dir pattern: .pcore/state
const WORKTREE_STATE_SEGMENTS = ['.pcore', 'state'];

interface NodeApis {
  existsSync: (file: string) => boolean;
  join: (...segments: string[]) => string;
  normalize: (file: string) => string;
  homedir: () => string;
  execSync: (command: string, options?: Record<string, unknown>) => string;
}

let cachedNodeApis: NodeApis | null | undefined;

/**
 * Node built-ins for filesystem discovery, or `null` in a browser bundle.
 * Never throws: in the browser there is no `require`, and a missing/handcapped
 * Node runtime degrades to `null` (callers return safe defaults).
 */
function nodeApis(): NodeApis | null {
  if (cachedNodeApis !== undefined) return cachedNodeApis;
  // Browser bundle: `window` exists and there is no Node `process`/`require`.
  // Vite externalizes `fs`/`path`/`os`/`child_process`, so touching them here
  // would throw at import time and take the whole React tree down with it.
  const isBrowser = typeof window !== 'undefined' && typeof process === 'undefined';
  if (isBrowser || typeof require !== 'function') {
    cachedNodeApis = null;
    return null;
  }
  try {
    cachedNodeApis = {
      existsSync: require('fs').existsSync,
      join: require('path').join,
      normalize: require('path').normalize,
      homedir: require('os').homedir,
      execSync: require('child_process').execSync,
    };
  } catch {
    cachedNodeApis = null;
  }
  return cachedNodeApis;
}

/** Read one env var without assuming `process` exists (browser-safe). */
function envValue(name: string): string {
  try {
    if (typeof process !== 'undefined' && process.env && process.env[name]) {
      return process.env[name];
    }
  } catch {
    // no process in the browser
  }
  return '';
}

/**
 * Global state dir: `PCORE_STATE_DIR` → `HOME` → `USERPROFILE` → `os.homedir()`
 * (Node/server context only — the SPA gets these from `GET /api/state-dirs`).
 * The home base is normalized before joining so a drive letter is never glued
 * to a `/` and `C:\Users\x`, `/mnt/c/Users/x` and UNC paths all survive.
 */
function getEnvStateDir(): string {
  const explicit = envValue('PCORE_STATE_DIR');
  if (explicit) return explicit;

  const apis = nodeApis();
  if (!apis) return '';
  try {
    const home = envValue('HOME') || envValue('USERPROFILE') || apis.homedir();
    if (!home) return '';
    return apis.join(apis.normalize(home), ...GLOBAL_STATE_SEGMENTS);
  } catch {
    return '';
  }
}

function parseGitWorktrees(): string[] {
  const apis = nodeApis();
  if (!apis) return [];
  try {
    const output = apis.execSync('git worktree list --porcelain', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    const worktrees: string[] = [];
    const mainWorktree =
      typeof process !== 'undefined' && typeof process.cwd === 'function' ? process.cwd() : null;
    const lines = output.trim().split('\n');

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        const worktreePath = line.slice('worktree '.length).trim();
        // Skip the main worktree (first one)
        if (worktreePath !== mainWorktree) {
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

function getWorktreeStateDir(worktreePath: string): string | null {
  const apis = nodeApis();
  if (!apis) return null;
  // Worktree state dir pattern: .pcore/state
  return apis.join(worktreePath, ...WORKTREE_STATE_SEGMENTS);
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
  const apis = nodeApis();
  // Browser: no filesystem — the server owns discovery (GET /api/state-dirs).
  if (!apis) return [];

  try {
    const dirs: StateDirInfo[] = [];

    // Global state dir
    const globalStateDir = getEnvStateDir();
    if (globalStateDir && apis.existsSync(globalStateDir)) {
      dirs.push({ path: globalStateDir, isWorktree: false });
    }

    // Worktree state dirs
    const worktreePaths = parseGitWorktrees();
    for (const wtPath of worktreePaths) {
      const wtStateDir = getWorktreeStateDir(wtPath);
      if (wtStateDir && apis.existsSync(wtStateDir)) {
        dirs.push({
          path: wtStateDir,
          isWorktree: true,
          runId: getRunIdFromWorktree(wtPath),
        });
      }
    }

    return dirs;
  } catch {
    return [];
  }
}

export function getGlobalStateDir(): string {
  return getEnvStateDir();
}

export function getWorktreeStateDirs(): StateDirInfo[] {
  const dirs: StateDirInfo[] = [];
  const worktreePaths = parseGitWorktrees();
  for (const wtPath of worktreePaths) {
    const wtStateDir = getWorktreeStateDir(wtPath);
    if (wtStateDir) {
      try {
        if (nodeApis()?.existsSync(wtStateDir)) {
          dirs.push({
            path: wtStateDir,
            isWorktree: true,
            runId: getRunIdFromWorktree(wtPath),
          });
        }
      } catch {
        // filesystem unavailable
      }
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

export type { StateDirInfo } from './types';
