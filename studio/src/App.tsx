import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { StateProvider, useStateContext } from './lib/StateContext';
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
      <div className="p-4 border-b border-gray-700">
        <p className="text-xs text-gray-400">No state directories found</p>
        <button
          onClick={refreshStateDirs}
          className="mt-2 text-xs text-blue-400 hover:underline"
        >
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 border-b border-gray-700">
      <label className="block text-xs font-medium text-gray-400 mb-1">State Directory</label>
      <select
        value={selectedStateDir || ''}
        onChange={(e) => setSelectedStateDir(e.target.value || null)}
        className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
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
        className="mt-2 text-xs text-blue-400 hover:underline"
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

  const statusColor = wsStatus === 'connected' ? 'bg-green-400' : wsStatus === 'reconnecting' ? 'bg-yellow-400' : 'bg-gray-400';
  const statusText = wsStatus || 'Live';

  return (
    <div className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full ${statusColor} animate-pulse`} />
      <span className="text-xs text-gray-400">{statusText}</span>
    </div>
  );
}

function Sidebar() {
  const location = useLocation();
  return (
    <aside className="w-64 bg-gray-900 text-white min-h-screen flex flex-col">
      <div className="p-4 border-b border-gray-700">
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
                ? 'bg-gray-700 text-white'
                : 'text-gray-300 hover:bg-gray-800 hover:text-white'
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

function Header() {
  const { selectedStateDir } = useStateContext();
  return (
    <header className="bg-gray-800 text-white px-6 py-4 border-b border-gray-700">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">P-Core Orchestra Studio</h2>
        <div className="flex items-center gap-4">
          {selectedStateDir && (
            <span className="text-xs text-gray-400 bg-gray-700 px-2 py-1 rounded">
              {selectedStateDir.replace(/^.*[\\/]hooks[\\/]state[\\/]/, '').replace(/^.*[\\/]\.pcore[\\/]state[\\/]/, '')}
            </span>
          )}
          <WsStatusIndicator />
        </div>
      </div>
    </header>
  );
}

function AppInner() {
  return (
    <div className="flex h-screen bg-gray-100">
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