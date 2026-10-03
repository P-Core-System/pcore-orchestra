import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { WorkItem } from '../lib/workItems';

interface BoardColumnProps {
  state: string;
  title: string;
  items: WorkItem[];
}

export function BoardColumn({ state, title, items }: BoardColumnProps) {
  const getStateColor = (state: string): string => {
    const colors: Record<string, string> = {
      TRIAGE: 'bg-gray-100 text-gray-700 border-gray-300',
      READY: 'bg-blue-100 text-blue-700 border-blue-300',
      PLANNED: 'bg-indigo-100 text-indigo-700 border-indigo-300',
      IN_PROGRESS: 'bg-yellow-100 text-yellow-700 border-yellow-300',
      VERIFYING: 'bg-purple-100 text-purple-700 border-purple-300',
      REVIEW_PENDING: 'bg-orange-100 text-orange-700 border-orange-300',
      COMPLETED: 'bg-green-100 text-green-700 border-green-300',
      NEEDS_HUMAN: 'bg-red-100 text-red-700 border-red-300',
      CANCELLED: 'bg-gray-200 text-gray-500 border-gray-400',
      FAILED: 'bg-red-200 text-red-800 border-red-400',
    };
    return colors[state] || 'bg-gray-100 text-gray-700 border-gray-300';
  };

  return (
    <div className="flex-1 min-w-[280px] max-w-[320px] bg-gray-50 rounded-lg border border-gray-200 flex flex-col">
      <div className="p-3 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getStateColor(state)}`}>
            {items.length}
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[400px]">
        {items.length === 0 ? (
          <div className="text-center text-gray-400 text-sm py-8">Drop items here</div>
        ) : (
          items.map((item) => <BoardWorkItemCard key={item.ticketId} item={item} />)
        )}
      </div>
    </div>
  );
}

interface BoardWorkItemCardProps {
  item: WorkItem;
}

function BoardWorkItemCard({ item }: BoardWorkItemCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.ticketId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-white rounded border border-gray-200 p-3 shadow-sm hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
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
            <span>Created: {formatDate(item.createdAt || Date.now())}</span>
            <span>Updated: {formatTime(item.updatedAt)}</span>
          </div>
          {item.transitions && item.transitions.length > 0 && (
            <div className="mt-1 text-xs text-gray-400">
              Transitions: {item.transitions.length}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}