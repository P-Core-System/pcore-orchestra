import { useRunPolling } from '../hooks/useRunPolling';
import { RunList } from './RunList';
import { RunDetail } from './RunDetail';

export function RunViewer({ initialStateDir }: { initialStateDir?: string }) {
  const {
    runs,
    loading,
    error,
    refresh,
    selectedRun,
    selectRun,
    stateDirs,
    selectedStateDir,
    setSelectedStateDir,
  } = useRunPolling(initialStateDir);

  return (
    <div className="p-6 h-full flex flex-col">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-default">Conductor Runs</h2>
          <p className="text-muted mt-1">{runs.length} runs found</p>
        </div>
        <div className="flex items-center gap-4">
          <select
            value={selectedStateDir || ''}
            onChange={(e) => setSelectedStateDir(e.target.value || undefined)}
            className="px-3 py-2 border border-line-strong rounded-lg text-sm focus:ring-2 focus:ring-accent focus:border-accent"
          >
            <option value="">Global State</option>
            {stateDirs.map((dir) => (
              <option key={dir.path} value={dir.path}>
                {dir.isWorktree ? '🌿 Worktree: ' : '📁 '} {dir.path}
              </option>
            ))}
          </select>
          <button
            onClick={refresh}
            disabled={loading}
            className="px-4 py-2 bg-accent text-on-accent rounded-lg hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mb-4 p-4 bg-err border border-err-line rounded-lg text-err-fg">
          Error: {error.message}
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 overflow-hidden flex flex-col lg:flex-row gap-6">
        {/* Run List Panel */}
        <div className="lg:w-2/5 flex-1 bg-surface rounded-lg border border-line flex flex-col min-h-0">
          <div className="p-4 border-b border-line">
            <h3 className="font-semibold text-default">Run List</h3>
          </div>
          <div className="flex-1 overflow-auto p-4">
            <RunList
              runs={runs}
              onSelect={selectRun}
              selectedRunId={selectedRun?.runId}
              loading={loading}
            />
          </div>
        </div>

        {/* Run Detail Panel */}
        <div className="lg:w-3/5 flex-1 bg-surface rounded-lg border border-line flex flex-col min-h-0">
          <div className="p-4 border-b border-line">
            <h3 className="font-semibold text-default">Run Details</h3>
          </div>
          <div className="flex-1 overflow-auto">
            <RunDetail run={selectedRun} />
          </div>
        </div>
      </div>
    </div>
  );
}