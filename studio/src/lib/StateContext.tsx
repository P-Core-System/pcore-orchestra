/**
 * StateContext - React context for managing state directory selection
 * Provides discovered state dirs and selected state dir to all data layers
 */

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { fetchStateDirs } from './api';

interface StateDirInfo {
  path: string;
  isWorktree: boolean;
  runId?: string;
}

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
  // const [loading, setLoading] = useState(true);

  const refreshStateDirs = async () => {
    // setLoading(true);
    try {
      const dirs = await fetchStateDirs();
      setStateDirs(dirs);

      // Auto-select first available dir if none selected
      if (!selectedStateDir && dirs.length > 0) {
        setSelectedStateDir(dirs[0].path);
      } else if (selectedStateDir && !dirs.some((d) => d.path === selectedStateDir)) {
        // Selected dir no longer exists, pick first available
        setSelectedStateDir(dirs.length > 0 ? dirs[0].path : null);
      }
    } catch (err) {
      console.error("Failed to fetch state dirs:", err);
      setStateDirs([]);
    } finally {
      // setLoading(false);
    }
  };

  useEffect(() => {
    refreshStateDirs();
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

export type { StateDirInfo };
