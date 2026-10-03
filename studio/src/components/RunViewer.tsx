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
          <h2 className="text-2xl font-bold text-gray-900">Conductor Runs</h2>
          <p className="text-gray-500 mt-1">{runs.length} runs found</p>
        </div>
        <div className="flex items-center gap-4">
          <select
            value={selectedStateDir || ''}
            onChange={(e) => setSelectedStateDir(e.target.value || undefined)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          Error: {error.message}
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 overflow-hidden flex flex-col lg:flex-row gap-6">
        {/* Run List Panel */}
        <div className="lg:w-2/5 flex-1 bg-white rounded-lg border border-gray-200 flex flex-col min-h-0">
          <div className="p-4 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900">Run List</h3>
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
        <div className="lg:w-3/5 flex-1 bg-white rounded-lg border border-gray-200 flex flex-col min-h-0">
          <div className="p-4 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900">Run Details</h3>
          </div>
          <div className="flex-1 overflow-auto">
            <RunDetail run={selectedRun} />
          </div>
        </div>
      </div>
    </div>
  );
}