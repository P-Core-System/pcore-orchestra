import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { StateProvider, useStateContext } from './lib/StateContext';
import { useTheme } from './hooks/useTheme';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from './lib/queryKeys';
import WorkflowPage from './pages/WorkflowPage';
import BoardPage from './pages/BoardPage';
import RunsPage from './pages/RunsPage';
import RunDetailPage from './pages/RunDetailPage';
import TokensPage from './pages/TokensPage';

const navItems = [
  { path: '/', label: 'Workflow', icon: '📊' },
  { path: '/board', label: 'Board', icon: '📋' },
  { path: '/runs', label: 'Runs', icon: '▶️' },
  { path: '/tokens', label: 'Tokens', icon: '💰' },
];

function StateDirSelector() {
  const { stateDirs, selectedStateDir, setSelectedStateDir, refreshStateDirs } = useStateContext();

  if (stateDirs.length === 0) {
    return (
      <div className="p-4 border-b border-line">
        <p className="text-xs text-muted">No state directories found</p>
        <button
          onClick={refreshStateDirs}
          className="mt-2 text-xs text-accent-text hover:underline"
        >
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 border-b border-line">
      <label className="block text-xs font-medium text-muted mb-1">State Directory</label>
      <select
        value={selectedStateDir || ''}
        onChange={(e) => setSelectedStateDir(e.target.value || null)}
        className="w-full bg-elevated border border-line-strong rounded px-2 py-1 text-sm text-default focus:outline-none focus:ring-1 focus:ring-accent"
      >
        {stateDirs.map((dir) => (
          <option key={dir.path} value={dir.path}>
            {dir.isWorktree ? '🌿 ' : '🌐 '}{dir.path.replace(/^.*[\\/]hooks[\\/]state[\\/]/, '').replace(/^.*[\\/]\.pcore[\\/]state[\\/]/, '')}
            {dir.runId && ` (${dir.runId.slice(0, 8)})`}
          </option>
        ))}
      </select>
      <button
        onClick={refreshStateDirs}
        className="mt-2 text-xs text-accent-text hover:underline"
      >
        Refresh
      </button>
    </div>
  );
}

function WsStatusIndicator() {
  const { data: wsStatus } = useQuery({
    queryKey: queryKeys.wsStatus(),
    queryFn: async () => {
      // WS status is managed by useLiveQuery hook in main.tsx
      // This is a placeholder - actual status comes from context
      return 'connected';
    },
    refetchInterval: 10000,
    staleTime: 5000,
  });

  const statusColor = wsStatus === 'connected' ? 'bg-ok-line' : wsStatus === 'reconnecting' ? 'bg-warn-line' : 'bg-neutral-line';
  const statusText = wsStatus || 'Live';

  return (
    <div className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full ${statusColor} animate-pulse`} />
      <span className="text-xs text-muted">{statusText}</span>
    </div>
  );
}

function Sidebar() {
  const location = useLocation();
  return (
    <aside className="w-64 bg-elevated text-default min-h-screen flex flex-col">
      <div className="p-4 border-b border-line">
        <h1 className="text-xl font-bold">P-Core Orchestra Studio</h1>
      </div>
      <StateDirSelector />
      <nav className="flex-1 p-4 space-y-2">
        {navItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
              location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path))
                ? 'bg-active text-default'
                : 'text-muted hover:bg-hover hover:text-default'
            }`}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}

/**
 * Light/dark switch (design spec §7). The whole palette is CSS custom
 * properties, so this only flips one class on `<html>` — no re-render of the
 * page chrome is needed for the colours to change.
 */
function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-pressed={isDark}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="rounded border border-line-strong px-2 py-1 text-sm text-muted transition-colors hover:bg-hover hover:text-default focus:outline-none focus:ring-2 focus:ring-accent"
    >
      <span aria-hidden="true">{isDark ? '☀' : '☾'}</span>
      <span className="ml-1 text-xs">{isDark ? 'Light' : 'Dark'}</span>
    </button>
  );
}

function Header() {
  const { selectedStateDir } = useStateContext();
  return (
    <header className="bg-elevated text-default px-6 py-4 border-b border-line">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">P-Core Orchestra Studio</h2>
        <div className="flex items-center gap-4">
          {selectedStateDir && (
            <span className="text-xs text-muted bg-active px-2 py-1 rounded">
              {selectedStateDir.replace(/^.*[\\/]hooks[\\/]state[\\/]/, '').replace(/^.*[\\/]\.pcore[\\/]state[\\/]/, '')}
            </span>
          )}
          <WsStatusIndicator />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

function AppInner() {
  return (
    <div className="flex h-screen bg-canvas">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<WorkflowPage />} />
            <Route path="/board" element={<BoardPage />} />
            <Route path="/runs" element={<RunsPage />} />
            <Route path="/runs/:id" element={<RunDetailPage />} />
            <Route path="/tokens" element={<TokensPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <StateProvider>
      <AppInner />
    </StateProvider>
  );
}

export default App;