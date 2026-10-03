import type { WorkItem } from '../lib/workItems';

interface WorkItemCardProps {
  item: WorkItem;
}

export function WorkItemCard({ item }: WorkItemCardProps) {
  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <div className="bg-white rounded border border-gray-200 p-3 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
              {item.ticketId.slice(0, 8)}
            </span>
            {item.agent && (
              <span className="text-xs text-gray-400 font-medium">{item.agent}</span>
            )}
          </div>
          <h4 className="text-sm font-medium text-gray-900 truncate">
            {item.title || item.goal || 'Untitled'}
          </h4>
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
            <span>Created: {formatDate(item.createdAt)}</span>
            <span>Updated: {formatTime(item.updatedAt)}</span>
          </div>
          {item.transitions.length > 0 && (
            <div className="mt-1 text-xs text-gray-400">
              Transitions: {item.transitions.length}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}