/**
 * Type definitions for P-Core Orchestra Studio data layer
 * Matches conductor-state.js JSON structures
 */

export interface RunEntry {
  key: string;
  runId: string;
  workspace: string;
  sessionId: string;
  taskId: string;
  goal: string;
  status: 'in_progress' | 'completed' | 'failed' | 'stalled';
  phase: string;
  startedAt: number;
  updatedAt: number;
  durationMs?: number;
  worktreePath?: string;
}

export interface RunDetail extends RunEntry {
  phases: RunPhase[];
  gates: RunGate[];
  evidence: RunEvidence[];
  handoff?: RunHandoff;
  tokens?: RunTokens;
}

export interface RunPhase {
  name: string;
  status: 'pending' | 'active' | 'completed' | 'failed' | 'skipped';
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  agent?: string;
  outcome?: PhaseOutcome;
}

export interface PhaseOutcome {
  decision: 'advance' | 'block' | 'fix';
  reason?: string;
  needsHuman?: boolean;
  evidenceDigest?: string;
  workItemContext?: string;
}

export interface RunGate {
  name: string;
  status: 'pending' | 'passed' | 'failed' | 'skipped';
  command?: string;
  exitCode?: number;
  durationMs?: number;
  stdoutExcerpt?: string;
  stderrExcerpt?: string;
  details?: string;
  startedAt?: number;
}

export interface RunEvidence {
  gate: string;
  ok: boolean;
  exitCode: number;
  durationMs: number;
  command: string;
  args: string[];
  cwd: string;
  stdoutExcerpt: string;
  stderrExcerpt: string;
  details: string;
  startedAt: number;
  evidenceDigest?: string;
}

export interface RunHandoff {
  fromPhase: string;
  toPhase: string;
  evidenceDigest: string;
  workItemContext: string;
  timestamp: number;
  clamped: boolean;
}

export interface RunTokens {
  runId: string;
  timestamp: number;
  byAgent: AgentTokens[];
  byPhase: PhaseTokens[];
  total: number;
  budget: number;
  overBudget: boolean;
}

export interface AgentTokens {
  agent: string;
  total: number;
  average: number;
  budget: number;
  overBudget: boolean;
  runs: number;
}

export interface PhaseTokens {
  phase: string;
  total: number;
  average: number;
  budget: number;
  runs: number;
}

export interface TokenState {
  runs: RunTokens[];
  aggregated: {
    byAgent: AgentTokens[];
    byPhase: PhaseTokens[];
    byRun: RunTokens[];
    trend: RunTokens[];
  };
}

export interface DomainEvent {
  id: string;
  type: string;
  timestamp: number;
  runId?: string;
  sessionId?: string;
  ticketId?: string;
  data: Record<string, unknown>;
}

export interface EvidenceRunEvent extends DomainEvent {
  type: 'evidence.run';
  data: {
    runId: string;
    phase: string;
    records: RunEvidence[];
  };
}

export interface PhaseOutcomeEvent extends DomainEvent {
  type: 'phase.outcome';
  data: {
    runId: string;
    phase: string;
    decision: 'advance' | 'block' | 'fix';
    reason?: string;
    needsHuman?: boolean;
    evidenceDigest?: string;
    workItemContext?: string;
  };
}

export interface ReviewEvent extends DomainEvent {
  type: 'review.requested' | 'review.resolved';
  data: {
    runId: string;
    phase: string;
    ticketId?: string;
    reason?: string;
  };
}

export interface TicketEvent extends DomainEvent {
  type: 'ticket.created' | 'ticket.transitioned';
  data: {
    ticketId: string;
    title: string;
    state: TicketState;
    fromState?: TicketState;
    toState?: TicketState;
    agent?: string;
    goal?: string;
  };
}

export type TicketState =
  | 'TRIAGE'
  | 'READY'
  | 'PLANNED'
  | 'IN_PROGRESS'
  | 'VERIFYING'
  | 'REVIEW_PENDING'
  | 'COMPLETED'
  | 'NEEDS_HUMAN'
  | 'CANCELLED'
  | 'FAILED';

export interface WorkItem {
  ticketId: string;
  title: string;
  state: TicketState;
  agent?: string;
  goal?: string;
  createdAt: number;
  updatedAt: number;
  transitions: Array<{
    from: TicketState;
    to: TicketState;
    at: number;
  }>;
}

export interface StateDirInfo {
  path: string;
  isWorktree: boolean;
  runId?: string;
}

export interface CyclePhase {
  name: string;
  status: 'pending' | 'active' | 'completed' | 'failed' | 'skipped';
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  agent?: string;
  outcome?: PhaseOutcome;
}

export interface CycleReport {
  runId: string;
  workspace: string;
  sessionId: string;
  taskId: string;
  goal: string;
  status: 'in_progress' | 'completed' | 'failed' | 'stalled';
  phase: string;
  startedAt: number;
  updatedAt: number;
  durationMs?: number;
  phases: CyclePhase[];
  worktreePath?: string;
}