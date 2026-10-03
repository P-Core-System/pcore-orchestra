import type { RunEntry } from '../lib/conductorRuns';

interface RunListProps {
  runs: RunEntry[];
  onSelect: (runId: string) => void;
  selectedRunId?: string;
  loading?: boolean;
}

export function RunList({ runs, onSelect, selectedRunId, loading }: RunListProps) {
  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
  };

  const getStatusBadge = (run: RunEntry): { label: string; className: string } => {
    if (run.status === 'in_progress') {
      return { label: 'Active', className: 'bg-blue-100 text-blue-700' };
    }
    if (run.status === 'completed') {
      return { label: 'Completed', className: 'bg-green-100 text-green-700' };
    }
    if (run.status === 'failed') {
      return { label: 'Failed', className: 'bg-red-100 text-red-700' };
    }
    if (run.status === 'stalled') {
      return { label: 'Stalled', className: 'bg-yellow-100 text-yellow-700' };
    }
    return { label: run.status, className: 'bg-gray-100 text-gray-700' };
  };

  const truncate = (str: string, len: number): string => {
    if (str.length <= len) return str;
    return str.slice(0, len - 3) + '...';
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-500">
        Loading runs...
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        No runs found. Check state directory configuration.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="px-4 py-3 text-left font-medium text-gray-500">Run ID</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Goal</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Phase</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Started</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Duration</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Workspace</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const status = getStatusBadge(run);
            const duration = run.durationMs ? formatDuration(run.durationMs) : '-';
            return (
              <tr
                key={run.key}
                onClick={() => onSelect(run.runId)}
                className={`border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors ${
                  selectedRunId === run.runId ? 'bg-blue-50' : ''
                }`}
              >
                <td className="px-4 py-3 font-mono text-xs text-gray-600">
                  {run.runId.slice(0, 12)}
                </td>
                <td className="px-4 py-3 text-gray-900 max-w-xs truncate" title={run.goal}>
                  {truncate(run.goal, 50)}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${status.className}`}>
                    {status.label}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600">{run.phase}</td>
                <td className="px-4 py-3 text-gray-500">{formatTime(run.startedAt)}</td>
                <td className="px-4 py-3 text-gray-500 font-mono">{duration}</td>
                <td className="px-4 py-3 text-gray-500">{run.workspace}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}