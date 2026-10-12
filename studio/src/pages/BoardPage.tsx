import { useState, useMemo, useCallback } from 'react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchWorkItems, patchWorkItemState, type WorkItem as ApiWorkItem, type TicketState } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { TICKET_STATES, type WorkItem as LocalWorkItem } from '../lib/workItems';
import { BoardColumn } from '../components/BoardColumn';

/**
 * Board page — route `/board` (spec T3).
 *
 * 10 columns for the 10 TICKET_STATES with @dnd-kit drag-drop.
 * PATCH /api/workitems/:id mutation with optimistic update + rollback on 409.
 * Column mapping: TRIAGE↔DRAFT, NEEDS_HUMAN↔BLOCKED per server.
 */

const STATE_TITLES: Record<TicketState, string> = {
  TRIAGE: 'Triage',
  READY: 'Ready',
  PLANNED: 'Planned',
  IN_PROGRESS: 'In Progress',
  VERIFYING: 'Verifying',
  REVIEW_PENDING: 'Review Pending',
  COMPLETED: 'Completed',
  NEEDS_HUMAN: 'Needs Human',
  CANCELLED: 'Cancelled',
  FAILED: 'Failed',
};

// Server-side column mapping per spec
const COLUMN_MAPPING: Record<string, string> = {
  TRIAGE: 'DRAFT',
  NEEDS_HUMAN: 'BLOCKED',
  DRAFT: 'TRIAGE',
  BLOCKED: 'NEEDS_HUMAN',
};

export default function BoardPage() {
  const [workspaceFilter, setWorkspaceFilter] = useState('');
  const [sessionFilter, setSessionFilter] = useState('');
  const queryClient = useQueryClient();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  const workItemsQuery = useQuery({
    queryKey: queryKeys.workitems({ state: workspaceFilter || undefined, agent: sessionFilter || undefined }),
    queryFn: () => fetchWorkItems({ state: workspaceFilter || undefined, agent: sessionFilter || undefined, run: undefined }),
    staleTime: 5000,
    refetchInterval: 5000,
  });

  // Optimistic mutation for PATCH /api/workitems/:id
  const mutation = useMutation({
    mutationFn: ({ id, state }: { id: string; state: TicketState }) => patchWorkItemState(id, state),
    onMutate: async ({ id, state: newState }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.workitems() });

      const previousWorkItems = queryClient.getQueryData<ApiWorkItem[]>(queryKeys.workitems());

      queryClient.setQueryData<ApiWorkItem[]>(queryKeys.workitems(), (old) => {
        if (!old) return old;
        return old.map((item) =>
          item.id === id ? { ...item, state: newState, updatedAt: Date.now() } : item
        );
      });

      return { previousWorkItems };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousWorkItems) {
        queryClient.setQueryData(queryKeys.workitems(), context.previousWorkItems);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workitems() });
    },
  });

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const allItems = workItemsQuery.data ?? [];
      // active.id is the ticketId (local WorkItem.ticketId)
      const activeItem = allItems.find((item) => item.id === active.id);
      if (!activeItem) return;

      // Find the target state from the column ID
      const targetState = over.id as string;
      const mappedState = (COLUMN_MAPPING[targetState] || targetState) as TicketState;

      // Optimistic update via mutation - use the API id
      mutation.mutate({ id: activeItem.id, state: mappedState });
    },
    [workItemsQuery.data, mutation]
  );

  // Convert API WorkItem to local WorkItem type
  const convertToLocalWorkItem = (item: ApiWorkItem): LocalWorkItem & { id: string } => ({
    ticketId: item.id,
    id: item.id,
    title: item.title ?? '',
    goal: item.goal,
    agent: item.agent,
    state: item.state,
    createdAt: item.createdAt ?? Date.now(),
    updatedAt: item.updatedAt,
    transitions: item.transitions as { from: TicketState; to: TicketState; at: number }[],
  });

  const boardData = useMemo(() => {
    const apiItems = workItemsQuery.data ?? [];
    const items = apiItems.map(convertToLocalWorkItem);
    const columns = TICKET_STATES.map((state) => ({
      state,
      title: STATE_TITLES[state],
      count: items.filter((wi) => wi.state === state).length,
      items: items.filter((wi) => wi.state === state),
    }));
    const totalItems = items.length;
    return { columns, totalItems };
  }, [workItemsQuery.data]);

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-default">WorkItem Board</h2>
          <p className="text-muted mt-1">
            {boardData.totalItems} items across {TICKET_STATES.length} states
            {mutation.isPending && <span className="ml-2 text-sm text-accent-text">(syncing…)</span>}
          </p>
        </div>
        <div className="flex gap-4 flex-wrap">
          <select
            value={workspaceFilter}
            onChange={(e) => setWorkspaceFilter(e.target.value)}
            className="px-3 py-2 border border-line-strong rounded-lg text-sm focus:ring-2 focus:ring-accent focus:border-accent"
          >
            <option value="">All States</option>
            {TICKET_STATES.map((s) => (
              <option key={s} value={s}>{STATE_TITLES[s]}</option>
            ))}
          </select>
          <select
            value={sessionFilter}
            onChange={(e) => setSessionFilter(e.target.value)}
            className="px-3 py-2 border border-line-strong rounded-lg text-sm focus:ring-2 focus:ring-accent focus:border-accent"
          >
            <option value="">All Agents</option>
            {/* Agents would be populated from work items */}
          </select>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={boardData.columns.map((c) => c.state)} strategy={verticalListSortingStrategy}>
          <div className="overflow-x-auto">
            <div className="flex gap-4 min-w-max pb-4">
              {boardData.columns.map((column) => (
                <BoardColumn
                  key={column.state}
                  state={column.state}
                  title={column.title}
                  items={column.items}
                />
              ))}
            </div>
          </div>
        </SortableContext>
      </DndContext>

      {mutation.isError && (
        <div className="fixed bottom-4 right-4 bg-err border border-err-line text-err-fg px-4 py-3 rounded-lg shadow-lg dark:shadow-black/50 animate-slide-in">
          Failed to move item: {mutation.error?.message}
        </div>
      )}
    </div>
  );
}