import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchRuns, type RunSummary } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { formatTimestamp, formatDuration } from '../lib/format';

/**
 * Runs list page — route `/runs` (spec T4).
 *
 * Lists all conductor runs with status badge, goal snippet, startedAt, link to detail.
 */

export default function RunsPage() {
  const [statusFilter, setStatusFilter] = useState<string>('');

  const runsQuery = useQuery({
    queryKey: queryKeys.runs(),
    queryFn: fetchRuns,
    staleTime: 5000,
    refetchInterval: 5000,
  });

  const runs = runsQuery.data ?? [];
  const statuses = ['running', 'completed', 'failed', 'blocked'] as const;

  const filteredRuns = useMemo(() => {
    if (!statusFilter) return runs;
    return runs.filter((r) => r.status === statusFilter);
  }, [runs, statusFilter]);

  const getStatusBadge = (status: RunSummary['status']) => {
    const styles: Record<RunSummary['status'], string> = {
      running: 'bg-blue-100 text-blue-700',
      completed: 'bg-green-100 text-green-700',
      failed: 'bg-red-100 text-red-700',
      blocked: 'bg-yellow-100 text-yellow-700',
    };
    return styles[status] || 'bg-gray-100 text-gray-700';
  };

  const getStatusIcon = (status: RunSummary['status']) => {
    switch (status) {
      case 'running':
        return '▶️';
      case 'completed':
        return '✅';
      case 'failed':
        return '❌';
      case 'blocked':
        return '⏸️';
      default:
        return '❓';
    }
  };

  if (runsQuery.isLoading) {
    return (
      <div className="p-6 text-center text-gray-500">
        Loading runs…
      </div>
    );
  }

  if (runsQuery.isError) {
    return (
      <div className="p-6 text-center text-red-500">
        Failed to load runs: {runsQuery.error?.message}
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Conductor Runs</h2>
          <p className="text-gray-500 mt-1">{runs.length} total runs</p>
        </div>
        <div className="flex gap-2">
          {statuses.map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(statusFilter === status ? '' : status)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                statusFilter === status
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {getStatusIcon(status)} {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {filteredRuns.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">
          {runs.length === 0 ? 'No runs found in the state directory.' : `No runs with status "${statusFilter}".`}
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Run ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Goal</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Agent</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Phase</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Started</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Duration</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredRuns.map((run) => (
                <tr key={run.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(run.status)}`}>
                      {getStatusIcon(run.status)} {run.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap font-mono text-sm text-gray-900">
                    {run.id.length > 32 ? run.id.slice(0, 32) + '…' : run.id}
                  </td>
                  <td className="px-6 py-4 max-w-md">
                    <div className="text-sm text-gray-900 truncate" title={run.goal}>{run.goal || 'No goal'}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{run.agent}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{run.phase || '—'}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{formatTimestamp(run.startedAt)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-500">
                    {run.updatedAt && run.startedAt ? formatDuration(new Date(run.updatedAt).getTime() - new Date(run.startedAt).getTime()) : '—'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <Link
                      to={`/runs/${encodeURIComponent(run.id)}`}
                      className="text-blue-600 hover:text-blue-900 font-medium"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}