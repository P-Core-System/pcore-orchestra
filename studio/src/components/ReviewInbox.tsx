import { useMemo } from 'react';
import { ReviewItem } from './ReviewItem';
import type { DomainEvent, ReviewEvent, PhaseOutcomeEvent } from '../lib/domainEvents';

interface ReviewInboxProps {
  events: DomainEvent[];
}

export function ReviewInbox({ events }: ReviewInboxProps) {
  const reviewItems = useMemo(() => {
    const reviewEvents = events.filter((e): e is ReviewEvent => e.type === 'review.requested' || e.type === 'review.resolved');
    const phaseOutcomes = events.filter((e): e is PhaseOutcomeEvent => e.type === 'phase.outcome');

    // Build set of resolved review IDs (review.resolved + advance events)
    const resolvedKeys = new Set<string>();
    for (const event of events) {
      if (event.type === 'review.resolved') {
        const data = event.data as Record<string, unknown>;
        const runId = (data.runId as string) || '';
        const phase = (data.phase as string) || '';
        const ticketId = (data.ticketId as string) || '';
        const key = `${runId}-${phase}-${ticketId}`;
        resolvedKeys.add(key);
      }
      // Also consider advance as resolving a review
      if (event.type === 'phase.outcome') {
        const data = event.data as Record<string, unknown>;
        if (data.decision === 'advance') {
          const runId = (data.runId as string) || '';
          const phase = (data.phase as string) || '';
          const ticketId = (data.ticketId as string) || '';
          const key = `${runId}-${phase}-${ticketId}`;
          resolvedKeys.add(key);
        }
      }
    }

    const items: Array<{
      ticketId: string;
      phase: string;
      reason: string;
      since: number;
      runId: string;
      needsHuman: boolean;
    }> = [];

    // Add review.requested events
    for (const event of reviewEvents) {
      if (event.type === 'review.requested') {
        const data = event.data as Record<string, unknown>;
        const runId = (data.runId as string) || '';
        const phase = (data.phase as string) || '';
        const ticketId = (data.ticketId as string) || '';
        const key = `${runId}-${phase}-${ticketId}`;
        if (!resolvedKeys.has(key)) {
          items.push({
            ticketId: ticketId || 'unknown',
            phase: phase || 'unknown',
            reason: (data.reason as string) || 'Review requested',
            since: event.timestamp,
            runId: runId || 'unknown',
            needsHuman: false,
          });
        }
      }
    }

    // Add phase.outcome with block or needsHuman that aren't resolved
    for (const event of phaseOutcomes) {
      const data = event.data as Record<string, unknown>;
      const decision = (data.decision as string) || '';
      const needsHuman = (data.needsHuman as boolean) || false;
      const runId = (data.runId as string) || '';
      const phase = (data.phase as string) || '';
      const ticketId = (data.ticketId as string) || '';
      
      if ((decision === 'block' || needsHuman) && runId && phase) {
        const key = `${runId}-${phase}-${ticketId}`;
        if (!resolvedKeys.has(key)) {
          items.push({
            ticketId: ticketId || 'unknown',
            phase,
            reason: (data.reason as string) || `Phase ${decision}${needsHuman ? ' (needs human)' : ''}`,
            since: event.timestamp,
            runId,
            needsHuman,
          });
        }
      }
    }

    // Sort by timestamp (oldest first)
    return items.sort((a, b) => a.since - b.since);
  }, [events]);

  if (reviewItems.length === 0) {
    return (
      <div className="p-8 text-center">
        <div className="text-gray-400 text-6xl mb-4">📭</div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">Nothing to triage</h3>
        <p className="text-gray-500">All reviews resolved — nothing queued for human triage</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Human Review Inbox</h2>
        <span className="px-3 py-1 bg-red-100 text-red-700 text-sm font-medium rounded-full">
          {reviewItems.length} pending
        </span>
      </div>
      <div className="space-y-3">
        {reviewItems.map((item, idx) => (
          <ReviewItem key={`${item.runId}-${item.phase}-${idx}`} item={item} onClick={() => {}} />
        ))}
      </div>
    </div>
  );
}