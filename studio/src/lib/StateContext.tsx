/**
 * StateContext - React context for managing state directory selection
 * Provides discovered state dirs and selected state dir to all data layers
 *
 * State dirs are discovered by the server (`GET /api/state-dirs`) — the
 * browser never touches the filesystem (architecture invariants 35/36).
 * `discoverStateDirs()` stays wired as the browser-safe local fallback, so a
 * failed/missing API can never leave the provider throwing.
 */

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { discoverStateDirs, StateDirInfo } from './stateResolver';
import { fetchStateDirs } from './api';

interface StateContextValue {
  stateDirs: StateDirInfo[];
  selectedStateDir: string | null;
  setSelectedStateDir: (path: string | null) => void;
  refreshStateDirs: () => Promise<void>;
}

const StateContext = createContext<StateContextValue | null>(null);

export function StateProvider({ children }: { children: ReactNode }) {
  const [stateDirs, setStateDirs] = useState<StateDirInfo[]>([]);
  const [selectedStateDir, setSelectedStateDir] = useState<string | null>(null);

  const refreshStateDirs = async () => {
    let dirs: StateDirInfo[] = [];
    try {
      dirs = await fetchStateDirs();
    } catch {
      // API unreachable: browser-safe discoverStateDirs() returns [] instead
      // of crashing the module graph.
      dirs = discoverStateDirs();
    }
    setStateDirs(dirs);

    // Auto-select first available dir if none selected; drop a stale selection.
    setSelectedStateDir((prev) => {
      if (!prev && dirs.length > 0) return dirs[0].path;
      if (prev && !dirs.some((d) => d.path === prev)) {
        return dirs.length > 0 ? dirs[0].path : null;
      }
      return prev;
    });
  };

  useEffect(() => {
    void refreshStateDirs();
  }, []);

  return (
    <StateContext.Provider value={{ stateDirs, selectedStateDir, setSelectedStateDir, refreshStateDirs }}>
      {children}
    </StateContext.Provider>
  );
}

export function useStateContext(): StateContextValue {
  const context = useContext(StateContext);
  if (!context) {
    throw new Error('useStateContext must be used within a StateProvider');
  }
  return context;
}

export type { StateDirInfo } from './stateResolver';
