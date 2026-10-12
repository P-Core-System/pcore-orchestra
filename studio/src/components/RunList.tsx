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
      return { label: 'Active', className: 'bg-info text-info-fg' };
    }
    if (run.status === 'completed') {
      return { label: 'Completed', className: 'bg-ok text-ok-fg' };
    }
    if (run.status === 'failed') {
      return { label: 'Failed', className: 'bg-err text-err-fg' };
    }
    if (run.status === 'stalled') {
      return { label: 'Stalled', className: 'bg-warn text-warn-fg' };
    }
    return { label: run.status, className: 'bg-neutral text-neutral-fg' };
  };

  const truncate = (str: string, len: number): string => {
    if (str.length <= len) return str;
    return str.slice(0, len - 3) + '...';
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-muted">
        Loading runs...
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="p-8 text-center text-muted">
        No runs found. Check state directory configuration.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-sunken">
            <th className="px-4 py-3 text-left font-medium text-muted">Run ID</th>
            <th className="px-4 py-3 text-left font-medium text-muted">Goal</th>
            <th className="px-4 py-3 text-left font-medium text-muted">Status</th>
            <th className="px-4 py-3 text-left font-medium text-muted">Phase</th>
            <th className="px-4 py-3 text-left font-medium text-muted">Started</th>
            <th className="px-4 py-3 text-left font-medium text-muted">Duration</th>
            <th className="px-4 py-3 text-left font-medium text-muted">Workspace</th>
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
                className={`border-b border-line hover:bg-sunken cursor-pointer transition-colors ${
                  selectedRunId === run.runId ? 'bg-info' : ''
                }`}
              >
                <td className="px-4 py-3 font-mono text-xs text-muted">
                  {run.runId.slice(0, 12)}
                </td>
                <td className="px-4 py-3 text-default max-w-xs truncate" title={run.goal}>
                  {truncate(run.goal, 50)}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${status.className}`}>
                    {status.label}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted">{run.phase}</td>
                <td className="px-4 py-3 text-muted">{formatTime(run.startedAt)}</td>
                <td className="px-4 py-3 text-muted font-mono">{duration}</td>
                <td className="px-4 py-3 text-muted">{run.workspace}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}