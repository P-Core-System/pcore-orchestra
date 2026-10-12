import { WorkItemCard } from './WorkItemCard';
import type { WorkItemColumn, TicketState } from '../lib/workItems';

interface WorkItemColumnProps {
  column: WorkItemColumn;
}

export function WorkItemColumn({ column }: WorkItemColumnProps) {
  const getStateColor = (state: TicketState): string => {
    const colors: Record<TicketState, string> = {
      TRIAGE: 'bg-neutral text-neutral-fg',
      READY: 'bg-info text-info-fg',
      PLANNED: 'bg-plan text-plan-fg',
      IN_PROGRESS: 'bg-progress text-progress-fg',
      VERIFYING: 'bg-verify text-verify-fg',
      REVIEW_PENDING: 'bg-review text-review-fg',
      COMPLETED: 'bg-ok text-ok-fg',
      NEEDS_HUMAN: 'bg-err text-err-fg',
      CANCELLED: 'bg-sunken text-muted',
      FAILED: 'bg-err text-err-fg',
    };
    return colors[state] || 'bg-neutral text-neutral-fg';
  };

  return (
    <div className="flex-1 min-w-[280px] max-w-[320px] bg-sunken rounded-lg border border-line flex flex-col">
      <div className="p-3 border-b border-line">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-default">{column.title}</h3>
          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getStateColor(column.state)}`}>
            {column.count}
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[400px]">
        {column.items.length === 0 ? (
          <div className="text-center text-muted text-sm py-8">No items</div>
        ) : (
          column.items.map((item) => <WorkItemCard key={item.ticketId} item={item} />)
        )}
      </div>
    </div>
  );
}