import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchRun, fetchTokenAggregates, type RunPhase, type RunGate, type RunHandoff } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { clampExcerpt, formatDuration, formatTimestamp } from '../lib/format';

/**
 * Run detail timeline — route `/runs/:id` (spec T4).
 *
 * Phase blocks, gate badges pass/fail, evidence excerpts, handoff digest,
 * per-phase tokens from /api/runs/:id.
 */

export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const runId = id || '';

  const runQuery = useQuery({
    queryKey: queryKeys.run(runId),
    queryFn: () => fetchRun(runId),
    enabled: runId.length > 0,
    staleTime: 5000,
    refetchInterval: 5000,
  });

  const tokensQuery = useQuery({
    queryKey: queryKeys.tokens(),
    queryFn: fetchTokenAggregates,
    staleTime: 30000,
  });

  const run = runQuery.data;
  const aggregates = tokensQuery.data;

  const getPhaseStatusClass = (state: RunPhase['state']): string => {
    switch (state) {
      case 'running': return 'bg-info text-info-fg';
      case 'completed': return 'bg-ok text-ok-fg';
      case 'failed': return 'bg-err text-err-fg';
      case 'blocked': return 'bg-warn text-warn-fg';
      case 'idle': return 'bg-neutral text-neutral-fg';
      default: return 'bg-neutral text-neutral-fg';
    }
  };

  const getGateStatusClass = (result: RunGate['result']): string => {
    switch (result) {
      case 'pass': return 'bg-ok text-ok-fg';
      case 'fail': return 'bg-err text-err-fg';
      case 'skip': return 'bg-neutral text-neutral-fg';
      default: return 'bg-warn text-warn-fg';
    }
  };

  const getGateIcon = (result: RunGate['result']) => {
    switch (result) {
      case 'pass': return '✅';
      case 'fail': return '❌';
      case 'skip': return '⏭️';
      default: return '❓';
    }
  };

  const findPhaseTokens = (phaseName: string) => {
    if (!aggregates?.byPhase) return null;
    return aggregates.byPhase.find((p) => p.phase === phaseName);
  };

  const findHandoffForPhase = (phaseName: string): RunHandoff | undefined => {
    if (!run?.handoffs) return undefined;
    return run.handoffs.find((h) => h.fromPhase === phaseName || h.toPhase === phaseName);
  };

  if (runQuery.isLoading) {
    return (
      <div className="p-6 text-center text-muted">
        Loading run detail…
      </div>
    );
  }

  if (runQuery.isError) {
    return (
      <div className="p-6 text-center text-err-fg">
        Failed to load run: {runQuery.error?.message}
        <button
          onClick={() => navigate('/runs')}
          className="ml-4 text-accent-text hover:underline"
        >
          Back to runs
        </button>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="p-6 text-center text-muted">
        Run not found
        <button
          onClick={() => navigate('/runs')}
          className="ml-4 text-accent-text hover:underline"
        >
          Back to runs
        </button>
      </div>
    );
  }

  const overallStatusClass: Record<string, string> = {
    running: 'bg-info text-info-fg',
    completed: 'bg-ok text-ok-fg',
    failed: 'bg-err text-err-fg',
    blocked: 'bg-warn text-warn-fg',
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header with back link */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/runs')}
          className="text-muted hover:text-muted text-sm font-medium"
        >
          ← Back to Runs
        </button>
        <div>
          <h1 className="text-2xl font-bold text-default">{run.goal || 'Untitled Run'}</h1>
          <div className="flex flex-wrap gap-4 mt-2 text-sm text-muted">
            <span className="font-mono">Run: {run.id}</span>
            <span>Workspace: {run.workspaceSlug}</span>
            <span>Session: {run.sessionId}</span>
            <span>Task: {run.taskId}</span>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <span className={`px-3 py-1 text-sm font-medium rounded-full ${overallStatusClass[run.status] || 'bg-neutral text-neutral-fg'}`}>
            {run.status.charAt(0).toUpperCase() + run.status.slice(1)}
          </span>
          <span className="text-sm font-mono text-muted">
            {run.endedAt && run.startedAt ? formatDuration(new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime()) : 'In progress'}
          </span>
        </div>
      </div>

      {/* Timeline - Phase blocks */}
      <section className="bg-surface rounded-lg border border-line overflow-hidden">
        <div className="p-4 border-b border-line">
          <h2 className="font-semibold text-default">Phase Timeline ({run.phases?.length || 0})</h2>
        </div>
        <div className="divide-y divide-line">
          {run.phases?.map((phase: RunPhase) => {
            const phaseTokens = findPhaseTokens(phase.name);
            const handoff = findHandoffForPhase(phase.name);
            const phaseGates = run.gates?.filter((g: RunGate) => g.phase === phase.name) || [];
            const hasEvidence = phaseGates.some((g: RunGate) => g.evidencePointer);

            return (
              <div key={phase.name} className="p-4 hover:bg-sunken">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${getPhaseStatusClass(phase.state)}`}>
                      {phase.state.charAt(0).toUpperCase() + phase.state.slice(1)}
                    </span>
                    <span className="font-medium text-default">{phase.name}</span>
                    {phase.agent && <span className="text-sm text-muted">{phase.agent}</span>}
                    {phaseTokens && (
                      <span className="text-xs text-muted bg-sunken px-2 py-0.5 rounded font-mono">
                        Tokens: {phaseTokens.total.toLocaleString()} / {(phaseTokens.budget || 0).toLocaleString()}
                        {phaseTokens.budget && phaseTokens.total > phaseTokens.budget && <span className="text-err-fg ml-1">(OVER)</span>}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted">
                    {phase.startedAt && <span>Started: {formatTimestamp(phase.startedAt)}</span>}
                    {phase.endedAt && <span>Ended: {formatTimestamp(phase.endedAt)}</span>}
                    {phase.startedAt && phase.endedAt && (
                      <span className="font-mono">Duration: {formatDuration(new Date(phase.endedAt).getTime() - new Date(phase.startedAt).getTime())}</span>
                    )}
                  </div>
                </div>

                {/* Gates for this phase */}
                {phaseGates.length > 0 && (
                  <div className="mt-3 ml-8 pl-4 border-l-2 border-line space-y-2">
                    {phaseGates.map((gate: RunGate) => (
                      <div key={gate.id} className="flex items-center gap-3">
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getGateStatusClass(gate.result)}`}>
                          {getGateIcon(gate.result)} {gate.result.charAt(0).toUpperCase() + gate.result.slice(1)}
                        </span>
                        <span className="font-medium text-default">{gate.name || gate.id}</span>
                        <div className="flex items-center gap-3 text-xs text-muted">
                          {gate.at && <span>{formatTimestamp(gate.at)}</span>}
                          {gate.evidencePointer && (
                            <span className="text-accent-text hover:underline cursor-pointer" title={gate.evidencePointer}>
                              📎 Evidence
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Evidence excerpt */}
                {hasEvidence && (
                  <div className="mt-3 ml-8 pl-4 border-l-2 border-info-line">
                    <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Evidence Excerpt</div>
                    <pre className="bg-sunken rounded p-3 text-xs font-mono text-muted overflow-x-auto max-h-32 overflow-y-auto">
                      {clampExcerpt(
                        phaseGates
                          .filter((g: RunGate) => g.evidencePointer)
                          .map((g: RunGate) => `[${g.name}] ${g.evidencePointer}`)
                          .join('\n\n')
                      )}
                    </pre>
                  </div>
                )}

                {/* Handoff digest */}
                {handoff && (
                  <div className="mt-3 ml-8 pl-4 border-l-2 border-verify-line bg-verify rounded-r p-3">
                    <div className="text-xs font-semibold text-verify-fg uppercase tracking-wider mb-1">Handoff Digest</div>
                    <div className="text-sm text-muted">
                      <div><span className="font-medium">From:</span> {handoff.fromPhase} → <span className="font-medium">To:</span> {handoff.toPhase || '—'}</div>
                      <div className="mt-1"><span className="font-medium">Evidence:</span> {clampExcerpt(handoff.evidenceDigest)}</div>
                      <div className="mt-1 text-xs text-muted">{formatTimestamp(handoff.at)} {handoff.clamped && '(clamped)'}</div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* All Gates Summary */}
      {run.gates && run.gates.length > 0 && (
        <section className="bg-surface rounded-lg border border-line">
          <div className="p-4 border-b border-line">
            <h2 className="font-semibold text-default">All Gates ({run.gates.length})</h2>
          </div>
          <div className="divide-y divide-line p-4 space-y-3">
            {run.gates.map((gate: RunGate) => (
              <div key={gate.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 bg-sunken rounded">
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${getGateStatusClass(gate.result)}`}>
                    {getGateIcon(gate.result)} {gate.result.charAt(0).toUpperCase() + gate.result.slice(1)}
                  </span>
                  <span className="font-medium text-default">{gate.name || gate.id}</span>
                  {gate.phase && <span className="text-xs text-muted bg-surface px-2 py-0.5 rounded">{gate.phase}</span>}
                </div>
                <div className="flex items-center gap-4 text-sm text-muted">
                  {gate.exitCode !== undefined && (
                    <span className={`font-mono ${gate.exitCode === 0 ? 'text-ok-fg' : 'text-err-fg'}`}>
                      Exit: {gate.exitCode}
                    </span>
                  )}
                  {gate.at && <span>{formatTimestamp(gate.at)}</span>}
                  {gate.command && <span className="font-mono text-xs truncate max-w-xs" title={gate.command}>{gate.command}</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Handoffs */}
      {run.handoffs && run.handoffs.length > 0 && (
        <section className="bg-surface rounded-lg border border-line">
          <div className="p-4 border-b border-line">
            <h2 className="font-semibold text-default">Handoffs ({run.handoffs.length})</h2>
          </div>
          <div className="divide-y divide-line p-4 space-y-4">
            {run.handoffs.map((handoff: RunHandoff, idx) => (
              <div key={idx} className="bg-sunken rounded p-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <span className="px-2 py-1 text-xs font-medium bg-verify text-verify-fg rounded-full">Handoff</span>
                    <span className="font-medium text-default">{handoff.fromPhase} → {handoff.toPhase || 'END'}</span>
                  </div>
                  <span className="text-xs text-muted">{formatTimestamp(handoff.at)} {handoff.clamped && '(clamped)'}</span>
                </div>
                <div className="mt-2 text-sm text-muted">
                  <div><span className="font-medium">Evidence Digest:</span> {clampExcerpt(handoff.evidenceDigest)}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Per-phase tokens from aggregates */}
      {aggregates?.byPhase && aggregates.byPhase.length > 0 && (
        <section className="bg-surface rounded-lg border border-line">
          <div className="p-4 border-b border-line">
            <h2 className="font-semibold text-default">Token Usage by Phase</h2>
          </div>
          <div className="p-4 space-y-3">
            {aggregates.byPhase.map((pt) => {
              const budget = pt.budget || 0;
              const maxVal = Math.max(pt.total, budget);
              const budgetWidth = maxVal > 0 ? Math.min((budget / maxVal) * 100, 100) : 0;
              const totalWidth = maxVal > 0 ? Math.min((pt.total / maxVal) * 100, 100) : 0;
              return (
                <div key={pt.phase} className="flex items-center gap-4 p-3 bg-sunken rounded">
                  <span className="font-medium text-default min-w-[120px]">{pt.phase}</span>
                  <div className="flex-1 h-4 bg-sunken rounded overflow-hidden relative">
                    <div className="absolute inset-0 bg-active" style={{ width: `${budgetWidth}%` }} />
                    <div className={`absolute inset-0 rounded ${pt.total > budget ? 'bg-err' : 'bg-info'}`} style={{ width: `${totalWidth}%` }} />
                  </div>
                  <span className="text-sm font-mono text-muted w-32 text-right">
                    {pt.total.toLocaleString()} / {budget.toLocaleString()}
                    {pt.total > budget && <span className="text-err-fg ml-1">(OVER)</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}