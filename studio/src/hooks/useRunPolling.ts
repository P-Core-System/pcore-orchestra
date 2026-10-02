import { useState, useEffect, useCallback } from 'react';
import { listRuns, loadRun, type RunEntry, type RunDetail } from '../lib/conductorRuns';
import type { StateDirInfo } from '../lib/types';

interface UseRunPollingReturn {
  runs: RunEntry[];
  loading: boolean;
  error: Error | null;
  refresh: () => void;
  selectedRun: RunDetail | null;
  selectRun: (runId: string) => void;
  stateDirs: StateDirInfo[];
  selectedStateDir: string | undefined;
  setSelectedStateDir: (dir: string | undefined) => void;
}

export function useRunPolling(
  stateDir?: string,
  intervalMs = 5000
): UseRunPollingReturn {
  const [runs, setRuns] = useState<RunEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunDetail | null>(null);
  const [stateDirs, setStateDirs] = useState<StateDirInfo[]>([]);
  const [selectedStateDir, setSelectedStateDir] = useState<string | undefined>(stateDir);

  const fetchRuns = useCallback(async () => {
    try {
      setError(null);
      const data = listRuns(selectedStateDir);
      setRuns(data);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to load runs'));
    } finally {
      setLoading(false);
    }
  }, [selectedStateDir]);

  const refresh = useCallback(() => {
    setLoading(true);
    fetchRuns();
  }, [fetchRuns]);

  const selectRun = useCallback((runId: string) => {
    const runDetail = loadRun(runId, selectedStateDir);
    setSelectedRun(runDetail);
  }, [selectedStateDir]);

  // Initial fetch
  useEffect(() => {
    fetchRuns();
    // Also discover state dirs
    const dirs = stateDir ? [{ path: stateDir, isWorktree: false }] : [];
    setStateDirs(dirs);
  }, [fetchRuns, stateDir]);

  // Polling
  useEffect(() => {
    const interval = setInterval(fetchRuns, intervalMs);
    return () => clearInterval(interval);
  }, [fetchRuns, intervalMs]);

  return {
    runs,
    loading,
    error,
    refresh,
    selectedRun,
    selectRun,
    stateDirs,
    selectedStateDir,
    setSelectedStateDir,
  };
}