/**
 * WorkItem board logic - Triage → Done with TICKET_STATES mapping
 * Exact 10 states from domain/entities.js
 */

import type { WorkItem, TicketState, DomainEvent } from './types';

export type { WorkItem, TicketState } from './types';

export const TICKET_STATES: TicketState[] = [
  'TRIAGE',
  'READY',
  'PLANNED',
  'IN_PROGRESS',
  'VERIFYING',
  'REVIEW_PENDING',
  'COMPLETED',
  'NEEDS_HUMAN',
  'CANCELLED',
  'FAILED',
];

export interface WorkItemColumn {
  state: TicketState;
  title: string;
  count: number;
  items: WorkItem[];
}

export interface BoardData {
  columns: WorkItemColumn[];
  totalItems: number;
  filteredBy?: { workspace?: string; session?: string };
}

export function deriveWorkItems(events: DomainEvent[]): WorkItem[] {
  const ticketEvents = events.filter(
    (e) => e.type === 'ticket.created' || e.type === 'ticket.transitioned'
  ) as Array<DomainEvent & { data: Record<string, unknown> }>;

  const workItemsMap = new Map<string, WorkItem>();

  for (const event of ticketEvents) {
    const data = event.data;
    const ticketId = data.ticketId as string;

    if (event.type === 'ticket.created') {
      const title = (data.title as string) || '';
      const state = (data.state as TicketState) || 'TRIAGE';
      const agent = data.agent as string | undefined;
      const goal = data.goal as string | undefined;

      workItemsMap.set(ticketId, {
        ticketId,
        title,
        state,
        agent,
        goal,
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
        transitions: [],
      });
    } else if (event.type === 'ticket.transitioned') {
      const existing = workItemsMap.get(ticketId);
      const fromState = data.fromState as TicketState | undefined;
      const toState = data.toState as TicketState | undefined;

      if (existing && toState) {
        existing.state = toState;
        existing.updatedAt = event.timestamp;
        if (fromState) {
          existing.transitions.push({ from: fromState, to: toState, at: event.timestamp });
        }
      } else if (toState) {
        workItemsMap.set(ticketId, {
          ticketId,
          title: '',
          state: toState,
          createdAt: event.timestamp,
          updatedAt: event.timestamp,
          transitions: fromState ? [{ from: fromState, to: toState, at: event.timestamp }] : [],
        });
      }
    }
  }

  return Array.from(workItemsMap.values());
}

export function buildBoardColumns(events: DomainEvent[], filter?: { workspace?: string; session?: string }): WorkItemColumn[] {
  let workItems = deriveWorkItems(events);

  // Apply filters if provided
  if (filter?.workspace || filter?.session) {
    // Filter by workspace/session would require runId correlation
    // For now, return all - filtering can be enhanced later
  }

  const columns: WorkItemColumn[] = [];

  for (const state of TICKET_STATES) {
    const items = workItems.filter((wi) => wi.state === state);
    columns.push({
      state,
      title: state.replace(/_/g, ' '),
      count: items.length,
      items,
    });
  }

  return columns;
}

export function getBoardData(events: DomainEvent[], filter?: { workspace?: string; session?: string }): BoardData {
  const columns = buildBoardColumns(events, filter);
  const totalItems = columns.reduce((sum, col) => sum + col.count, 0);

  return {
    columns,
    totalItems,
    filteredBy: filter,
  };
}

export function filterWorkItemsByState(workItems: WorkItem[], state: TicketState): WorkItem[] {
  return workItems.filter((wi) => wi.state === state);
}

export function getStateColor(state: TicketState): string {
  const colors: Record<TicketState, string> = {
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
}

export function getStateOrder(state: TicketState): number {
  return TICKET_STATES.indexOf(state);
}