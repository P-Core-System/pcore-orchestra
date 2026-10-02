/**
 * Read-only data layer for domain-events
 * Parses domain-events.json into typed events
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type {
  DomainEvent,
  EvidenceRunEvent,
  PhaseOutcomeEvent,
  ReviewEvent,
  TicketEvent,
  WorkItem,
  TicketState,
  StateDirInfo,
} from './types';

const DEFAULT_STATE_DIR = path.join(os.homedir(), '.config', 'opencode', 'hooks', 'state');

function getEnvStateDir(): string {
  return process.env.PCORE_STATE_DIR || DEFAULT_STATE_DIR;
}

function resolveDomainEventsPath(stateDir: string): string {
  return path.join(stateDir, 'domain-events.json');
}

function resolveWorktreeDomainEventsPath(worktreePath: string): string {
  return path.join(worktreePath, '.pcore', 'state', 'domain-events.json');
}

export function resolveDomainEventsPaths(worktreePath?: string): StateDirInfo[] {
  const dirs: StateDirInfo[] = [];

  const globalStateDir = getEnvStateDir();
  const globalEventsPath = resolveDomainEventsPath(globalStateDir);
  if (fs.existsSync(globalEventsPath)) {
    dirs.push({ path: globalEventsPath, isWorktree: false });
  }

  if (worktreePath) {
    const wtEventsPath = resolveWorktreeDomainEventsPath(worktreePath);
    if (fs.existsSync(wtEventsPath)) {
      dirs.push({ path: wtEventsPath, isWorktree: true });
    }
  }

  return dirs;
}

function readJsonSafe<T>(filePath: string): T | null {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export function loadEvents(stateDir?: string): DomainEvent[] {
  const targetDir = stateDir || getEnvStateDir();
  const eventsPath = resolveDomainEventsPath(targetDir);
  const events = readJsonSafe<DomainEvent[]>(eventsPath);
  return events || [];
}

export function loadEventsFromPath(eventsPath: string): DomainEvent[] {
  const events = readJsonSafe<DomainEvent[]>(eventsPath);
  return events || [];
}

function filterByRunId<T extends DomainEvent>(events: T[], runId: string): T[] {
  return events.filter((e) => e.runId === runId);
}

export function getEvidenceRuns(runId: string, stateDir?: string): EvidenceRunEvent[] {
  const events = loadEvents(stateDir);
  return filterByRunId(events.filter((e) => e.type === 'evidence.run') as EvidenceRunEvent[], runId);
}

export function getPhaseOutcomes(runId: string, stateDir?: string): PhaseOutcomeEvent[] {
  const events = loadEvents(stateDir);
  return filterByRunId(events.filter((e) => e.type === 'phase.outcome') as PhaseOutcomeEvent[], runId);
}

export function getReviewEvents(stateDir?: string): ReviewEvent[] {
  const events = loadEvents(stateDir);
  return events.filter((e) => e.type === 'review.requested' || e.type === 'review.resolved') as ReviewEvent[];
}

export function getTicketEvents(stateDir?: string): TicketEvent[] {
  const events = loadEvents(stateDir);
  return events.filter((e) => e.type === 'ticket.created' || e.type === 'ticket.transitioned') as TicketEvent[];
}

export function getWorkItems(stateDir?: string): WorkItem[] {
  const ticketEvents = getTicketEvents(stateDir);
  const workItemsMap = new Map<string, WorkItem>();

  for (const event of ticketEvents) {
    const data = event.data as Record<string, unknown>;
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
        // Transition event without prior create - create minimal work item
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

export function getWorkItemsByRun(runId: string, stateDir?: string): WorkItem[] {
  const allWorkItems = getWorkItems(stateDir);
  // Filter work items that belong to this run (via phase.outcome events)
  const phaseOutcomes = getPhaseOutcomes(runId, stateDir);
  const runTicketIds = new Set(phaseOutcomes.map((p) => p.data.ticketId).filter(Boolean) as string[]);
  
  if (runTicketIds.size === 0) return allWorkItems; // If no ticketIds in phase outcomes, return all
  
  return allWorkItems.filter((wi) => runTicketIds.has(wi.ticketId));
}

export function getWorkItemsForRun(runId: string, stateDir?: string): WorkItem[] {
  return getWorkItemsByRun(runId, stateDir);
}

export function getAllTicketStates(): TicketState[] {
  return [
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
}