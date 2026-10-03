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
}

export function getStateOrder(state: TicketState): number {
  return TICKET_STATES.indexOf(state);
}