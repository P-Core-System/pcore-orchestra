import React, { useState, useMemo } from 'react';
import type { RunEvidence } from '../lib/conductorRuns';

interface EvidenceTableProps {
  evidence: RunEvidence[];
  onRowClick?: (evidence: RunEvidence) => void;
}

export function EvidenceTable({ evidence, onRowClick }: EvidenceTableProps) {
  const [search, setSearch] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  const filteredEvidence = useMemo(() => {
    if (!search) return evidence;
    const lowerSearch = search.toLowerCase();
    return evidence.filter(
      (e) =>
        e.gate.toLowerCase().includes(lowerSearch) ||
        e.command.toLowerCase().includes(lowerSearch) ||
        e.stdoutExcerpt.toLowerCase().includes(lowerSearch) ||
        e.stderrExcerpt.toLowerCase().includes(lowerSearch) ||
        e.details.toLowerCase().includes(lowerSearch)
    );
  }, [evidence, search]);

  const sortedEvidence = useMemo(() => {
    if (!sortConfig) return filteredEvidence;
    return [...filteredEvidence].sort((a, b) => {
      const aVal = a[sortConfig.key as keyof RunEvidence];
      const bVal = b[sortConfig.key as keyof RunEvidence];
      if (aVal === bVal) return 0;
      const direction = sortConfig.direction === 'asc' ? 1 : -1;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return aVal.localeCompare(bVal) * direction;
      }
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return (aVal - bVal) * direction;
      }
      return 0;
    });
  }, [filteredEvidence, sortConfig]);

  const totalPages = Math.ceil(sortedEvidence.length / itemsPerPage);
  const paginatedEvidence = sortedEvidence.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const handleSort = (key: string) => {
    setSortConfig((current) => ({
      key,
      direction: current?.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const columns = [
    { key: 'gate', label: 'Gate' },
    { key: 'ok', label: 'OK' },
    { key: 'exitCode', label: 'Exit' },
    { key: 'durationMs', label: 'Duration' },
    { key: 'command', label: 'Command' },
    { key: 'stdoutExcerpt', label: 'Stdout' },
    { key: 'stderrExcerpt', label: 'Stderr' },
    { key: 'details', label: 'Details' },
  ];

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="p-4 border-b border-gray-200 flex flex-col sm:flex-row gap-4">
        <h3 className="font-semibold text-gray-900">Evidence Records ({evidence.length})</h3>
        <input
          type="text"
          placeholder="Search evidence..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full sm:w-64"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="px-4 py-3 text-left font-medium text-gray-500 cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort(col.key)}
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    {sortConfig?.key === col.key && (
                      <span>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {paginatedEvidence.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-gray-500">
                  No evidence records found
                </td>
              </tr>
            ) : (
              paginatedEvidence.map((e, idx) => (
                <tr
                  key={e.gate + idx}
                  onClick={() => onRowClick?.(e)}
                  className={`hover:bg-gray-50 cursor-pointer transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}
                >
                  <td className="px-4 py-3 font-medium text-gray-900">{e.gate}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${e.ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {e.ok ? 'PASS' : 'FAIL'}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-gray-600">
                    {e.exitCode !== undefined ? e.exitCode : '-'}
                  </td>
                  <td className="px-4 py-3 font-mono text-gray-500">{formatDuration(e.durationMs)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600 truncate max-w-[200px]" title={e.command}>
                    {e.command}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 truncate max-w-[150px]" title={e.stdoutExcerpt}>
                    {e.stdoutExcerpt || '-'}
                  </td>
                  <td className="px-4 py-3 text-xs text-red-500 truncate max-w-[150px]" title={e.stderrExcerpt}>
                    {e.stderrExcerpt || '-'}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600 truncate max-w-[200px]" title={e.details}>
                    {e.details || '-'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="p-4 border-t border-gray-200 flex items-center justify-between">
          <span className="text-sm text-gray-500">
            Page {currentPage} of {totalPages} ({sortedEvidence.length} records)
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 text-sm border border-gray-300 rounded disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1 text-sm border border-gray-300 rounded disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}