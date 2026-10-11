import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchRuns, type RunSummary } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import {
  ChevronRightIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/solid';

interface SessionGroup {
  sessionId: string;
  workspaceSlug: string;
  runs: RunSummary[];
  status: RunSummary['status'];
  startedAt: string | null;
  totalDuration: number;
  agents: string[];
}

// Module-level helper functions
function formatTimestamp(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatMs(ms: number) {
  if (ms <= 0) return '—';
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const hours = Math.floor(mins / 60);
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  if (mins > 0) return `${mins}m ${secs % 60}s`;
  return `${secs}s`;
}

function getStatusIcon(status: RunSummary['status']) {
  switch (status) {
    case 'running': return '▶️';
    case 'completed': return '✅';
    case 'failed': return '❌';
    case 'blocked': return '⏸️';
    default: return '❓';
  }
}

function getStatusBadge(status: RunSummary['status']) {
  const styles: Record<RunSummary['status'], string> = {
    running: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    blocked: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  };
  return styles[status] || 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400';
}

/**
 * Runs list page — route `/runs` (spec T4).
 * Groups runs by session (workspaceSlug + sessionId), showing all tasks/agents within.
 */
export default function RunsPage() {
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());

  const runsQuery = useQuery({
    queryKey: queryKeys.runs(),
    queryFn: fetchRuns,
    staleTime: 5000,
    refetchInterval: 5000,
  });

  const runs = runsQuery.data ?? [];
  const statuses = ['running', 'completed', 'failed', 'blocked'] as const;

  // Group runs by session (workspaceSlug + sessionId)
  const sessionGroups = useMemo(() => {
    const groups = new Map<string, SessionGroup>();
    
    for (const run of runs) {
      const key = `${run.workspaceSlug}:${run.sessionId}`;
      const existing = groups.get(key);
      
      if (!existing) {
        groups.set(key, {
          sessionId: run.sessionId ?? "",
          workspaceSlug: run.workspaceSlug ?? "",
          runs: [run],
          status: run.status,
          startedAt: run.startedAt ?? null,
          totalDuration: 0,
          agents: run.agent ? [run.agent] : [],
        });
      } else {
        existing.runs.push(run);
        // Update status priority: running > blocked > failed > completed
        const priority = { running: 4, blocked: 3, failed: 2, completed: 1 };
        if (priority[run.status] > priority[existing.status]) {
          existing.status = run.status;
        }
        if (run.startedAt && existing.startedAt && run.startedAt < existing.startedAt) {
          existing.startedAt = run.startedAt;
        }
        if (run.agent && !existing.agents.includes(run.agent)) {
          existing.agents.push(run.agent);
        }
      }
    }
    
    // Calculate total duration and sort runs within each session
    return Array.from(groups.values()).map((group) => {
      group.runs.sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
      const completedRuns = group.runs.filter(r => r.updatedAt && r.startedAt);
      group.totalDuration = completedRuns.reduce((sum, r) => 
        sum + (new Date(r.updatedAt!).getTime() - new Date(r.startedAt!).getTime()), 0);
      return group;
    }).sort((a, b) => {
      // Sort: running sessions first, then by start time desc
      const priority = { running: 4, blocked: 3, failed: 2, completed: 1 };
      const pa = priority[a.status] || 0;
      const pb = priority[b.status] || 0;
      if (pa !== pb) return pb - pa;
      return String(b.startedAt || '').localeCompare(String(a.startedAt || ''));
    });
  }, [runs]);

  const filteredGroups = useMemo(() => {
    if (!statusFilter) return sessionGroups;
    return sessionGroups.filter((g) => g.status === statusFilter);
  }, [sessionGroups, statusFilter]);

  const toggleSession = (sessionKey: string) => {
    const next = new Set(expandedSessions);
    if (next.has(sessionKey)) next.delete(sessionKey);
    else next.add(sessionKey);
    setExpandedSessions(next);
  };





  if (runsQuery.isLoading) {
    return (
      <div className="p-6 text-center text-gray-500 dark:text-gray-400">
        Loading runs…
      </div>
    );
  }

  if (runsQuery.isError) {
    return (
      <div className="p-6 text-center text-red-500 dark:text-red-400">
        Failed to load runs: {runsQuery.error?.message}
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Conductor Runs</h2>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            {sessionGroups.length} sessions · {runs.length} total tasks
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setStatusFilter('')}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              !statusFilter
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
            }`}
          >
            All
          </button>
          {statuses.map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(statusFilter === status ? '' : status)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                statusFilter === status
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
              }`}
            >
              {getStatusIcon(status)} {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {filteredGroups.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-12 text-center text-gray-500 dark:text-gray-400">
          {runs.length === 0 ? 'No runs found in the state directory.' : `No sessions with status "${statusFilter}".`}
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px]">
              <thead className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-12">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Session</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Workspace</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Tasks</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Agents</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Started</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Duration</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {filteredGroups.map((group) => {
                  const sessionKey = `${group.workspaceSlug}:${group.sessionId}`;
                  const isExpanded = expandedSessions.has(sessionKey);
                  
                  return (
                    <React.Fragment key={sessionKey}>
                      {/* Session header row */}
                      <tr className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors ${isExpanded ? 'bg-gray-50 dark:bg-gray-700/50' : ''}`} onClick={() => toggleSession(sessionKey)}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(group.status)}`}>
                            {getStatusIcon(group.status)} {group.status}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <button className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" onClick={(e) => e.stopPropagation()}>
                              {isExpanded ? <ChevronDownIcon className="w-5 h-5" /> : <ChevronRightIcon className="w-5 h-5" />}
                            </button>
                            <span className="font-mono text-sm text-gray-900 dark:text-gray-100">
                              {group.sessionId.length > 24 ? group.sessionId.slice(0, 24) + '…' : group.sessionId}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">{group.workspaceSlug}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">{group.runs.length}</td>
                        <td className="px-6 py-4">
                          <div className="flex flex-wrap gap-1">
                            {group.agents.length === 0 ? (
                              <span className="text-sm text-gray-400 dark:text-gray-500">—</span>
                            ) : (
                              group.agents.map((agent) => (
                                <span key={agent} className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded">
                                  {agent}
                                </span>
                              ))
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{formatTimestamp(group.startedAt)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-500 dark:text-gray-400">{formatMs(group.totalDuration)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <Link
                            to={`/runs/${encodeURIComponent(`${group.workspaceSlug}/${group.sessionId}`)}`}
                            className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
                          >
                            View all
                          </Link>
                        </td>
                      </tr>
                      
                      {/* Expanded task rows */}
                      {isExpanded && (
                        <tr className="bg-gray-25 dark:bg-gray-900/30">
                          <td colSpan={9} className="px-6 py-2">
                            <table className="w-full">
                              <thead>
                                <tr className="border-b border-gray-200 dark:border-gray-700">
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-12"></th>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Task ID</th>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Goal</th>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Agent</th>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Phase</th>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Started</th>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Duration</th>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                {group.runs.map((run) => (
                                  <tr key={run.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                    <td className="px-4 py-3 whitespace-nowrap">
                                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(run.status)}`}>
                                        {getStatusIcon(run.status)} {run.status}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3 font-mono text-sm text-gray-600 dark:text-gray-400">
                                      {run.taskId}
                                    </td>
                                    <td className="px-4 py-3 max-w-md">
                                      <div className="text-sm text-gray-900 dark:text-gray-100 truncate" title={run.goal}>{run.goal || 'No goal'}</div>
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{run.agent || '—'}</td>
                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{run.phase || '—'}</td>
                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{formatTimestamp(run.startedAt)}</td>
                                    <td className="px-4 py-3 whitespace-nowrap text-sm font-mono text-gray-500 dark:text-gray-400">
                                      {run.updatedAt && run.startedAt ? formatMs(new Date(run.updatedAt).getTime() - new Date(run.startedAt).getTime()) : '—'}
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-sm">
                                      <Link
                                        to={`/runs/${encodeURIComponent(run.id)}`}
                                        className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
                                      >
                                        View
                                      </Link>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
