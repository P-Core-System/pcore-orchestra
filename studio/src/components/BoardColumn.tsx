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
      TRIAGE: 'bg-neutral text-neutral-fg border-neutral-line',
      READY: 'bg-info text-info-fg border-info-line',
      PLANNED: 'bg-plan text-plan-fg border-plan-line',
      IN_PROGRESS: 'bg-progress text-progress-fg border-progress-line',
      VERIFYING: 'bg-verify text-verify-fg border-verify-line',
      REVIEW_PENDING: 'bg-review text-review-fg border-review-line',
      COMPLETED: 'bg-ok text-ok-fg border-ok-line',
      NEEDS_HUMAN: 'bg-err text-err-fg border-err-line',
      CANCELLED: 'bg-neutral text-neutral-fg border-neutral-line',
      FAILED: 'bg-err text-err-fg border-err-line',
    };
    return colors[state] || 'bg-neutral text-neutral-fg border-neutral-line';
  };

  return (
    <div className="flex-1 min-w-[280px] max-w-[320px] bg-sunken rounded-lg border border-line flex flex-col">
      <div className="p-3 border-b border-line">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-default">{title}</h3>
          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getStateColor(state)}`}>
            {items.length}
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[400px]">
        {items.length === 0 ? (
          <div className="text-center text-muted text-sm py-8">Drop items here</div>
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
      className="bg-surface rounded border border-line p-3 shadow-sm hover:shadow-md dark:shadow-none dark:hover:shadow-lg transition-shadow cursor-grab active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-xs text-muted bg-sunken px-1.5 py-0.5 rounded">
              {item.ticketId.slice(0, 8)}
            </span>
            {item.agent && (
              <span className="text-xs text-muted font-medium">{item.agent}</span>
            )}
          </div>
          <h4 className="text-sm font-medium text-default truncate">
            {item.title || item.goal || 'Untitled'}
          </h4>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted">
            <span>Created: {formatDate(item.createdAt || Date.now())}</span>
            <span>Updated: {formatTime(item.updatedAt)}</span>
          </div>
          {item.transitions && item.transitions.length > 0 && (
            <div className="mt-1 text-xs text-muted">
              Transitions: {item.transitions.length}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}