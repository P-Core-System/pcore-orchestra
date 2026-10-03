import { WorkItemCard } from './WorkItemCard';
import type { WorkItemColumn, TicketState } from '../lib/workItems';

interface WorkItemColumnProps {
  column: WorkItemColumn;
}

export function WorkItemColumn({ column }: WorkItemColumnProps) {
  const getStateColor = (state: TicketState): string => {
    const colors: Record<TicketState, string> = {
      TRIAGE: 'bg-gray-100 text-gray-700',
      READY: 'bg-blue-100 text-blue-700',
      PLANNED: 'bg-indigo-100 text-indigo-700',
      IN_PROGRESS: 'bg-yellow-100 text-yellow-700',
      VERIFYING: 'bg-purple-100 text-purple-700',
      REVIEW_PENDING: 'bg-orange-100 text-orange-700',
      COMPLETED: 'bg-green-100 text-green-700',
      NEEDS_HUMAN: 'bg-red-100 text-red-700',
      CANCELLED: 'bg-gray-200 text-gray-500',
      FAILED: 'bg-red-200 text-red-800',
    };
    return colors[state] || 'bg-gray-100 text-gray-700';
  };

  return (
    <div className="flex-1 min-w-[280px] max-w-[320px] bg-gray-50 rounded-lg border border-gray-200 flex flex-col">
      <div className="p-3 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">{column.title}</h3>
          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getStateColor(column.state)}`}>
            {column.count}
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[400px]">
        {column.items.length === 0 ? (
          <div className="text-center text-gray-400 text-sm py-8">No items</div>
        ) : (
          column.items.map((item) => <WorkItemCard key={item.ticketId} item={item} />)
        )}
      </div>
    </div>
  );
}