import React, { useState, useMemo } from 'react';
import { WorkItemColumn } from './WorkItemColumn';
import { buildBoardColumns, TICKET_STATES, type WorkItemColumn as WorkItemColumnType, type BoardData } from '../lib/workItems';
import type { DomainEvent } from '../lib/types';

interface WorkItemBoardProps {
  events: DomainEvent[];
  filter?: { workspace?: string; session?: string };
}

export function WorkItemBoard({ events, filter }: WorkItemBoardProps) {
  const [workspaceFilter, setWorkspaceFilter] = useState('');
  const [sessionFilter, setSessionFilter] = useState('');

  const boardData = useMemo(() => {
    // For now, use the basic buildBoardColumns - filtering can be enhanced
    const columns = buildBoardColumns(events, filter);
    const totalItems = columns.reduce((sum, col) => sum + col.count, 0);
    return { columns, totalItems };
  }, [events, filter]);

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">WorkItem Board</h2>
          <p className="text-gray-500 mt-1">
            {boardData.totalItems} items across {TICKET_STATES.length} states
          </p>
        </div>
        <div className="flex gap-4 flex-wrap">
          <select
            value={workspaceFilter}
            onChange={(e) => setWorkspaceFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">All Workspaces</option>
            <option value="default">default</option>
            {/* Additional workspaces would be populated from state */}
          </select>
          <select
            value={sessionFilter}
            onChange={(e) => setSessionFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">All Sessions</option>
            {/* Sessions would be populated from state */}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="flex gap-4 min-w-max pb-4">
          {boardData.columns.map((column) => (
            <WorkItemColumn key={column.state} column={column} />
          ))}
        </div>
      </div>
    </div>
  );
}