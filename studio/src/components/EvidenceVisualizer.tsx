import { useState } from 'react';
import { EvidenceTable } from './EvidenceTable';
import { EvidenceDetail } from './EvidenceDetail';
import type { RunDetail, RunEvidence } from '../lib/conductorRuns';

interface EvidenceVisualizerProps {
  run: RunDetail | null;
}

export function EvidenceVisualizer({ run }: EvidenceVisualizerProps) {
  const [selectedEvidence, setSelectedEvidence] = useState<RunEvidence | null>(null);

  if (!run) {
    return (
      <div className="p-8 text-center text-muted">
        Select a run to view evidence
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Handoff Digest */}
      {run.handoff && (
        <div className="bg-surface rounded-lg border border-line p-4">
          <h3 className="font-semibold text-default mb-3">Handoff Digest</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted">From Phase</p>
              <p className="font-medium text-default">{run.handoff.fromPhase}</p>
            </div>
            <div>
              <p className="text-muted">To Phase</p>
              <p className="font-medium text-default">{run.handoff.toPhase}</p>
            </div>
            <div>
              <p className="text-muted">Timestamp</p>
              <p className="font-medium text-default">{new Date(run.handoff.timestamp).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-muted">Clamped</p>
              <p className="font-medium text-default">{run.handoff.clamped ? 'Yes' : 'No'}</p>
            </div>
          </div>
          <div className="mt-4">
            <p className="text-muted text-sm mb-1">Evidence Digest</p>
            <p className="bg-sunken p-3 rounded text-sm font-mono text-muted whitespace-pre-wrap">
              {run.handoff.evidenceDigest}
            </p>
          </div>
          <div className="mt-4">
            <p className="text-muted text-sm mb-1">Work Item Context</p>
            <p className="bg-sunken p-3 rounded text-sm text-muted whitespace-pre-wrap">
              {run.handoff.workItemContext}
            </p>
          </div>
        </div>
      )}

      {/* Phase Outcomes with block/needs_human */}
      {run.phases.some((p) => p.outcome && (p.outcome.decision === 'block' || p.outcome.needsHuman)) && (
        <div className="bg-surface rounded-lg border border-line p-4">
          <h3 className="font-semibold text-default mb-3 text-err-fg">Phase Blocks / Needs Human</h3>
          <div className="space-y-3">
            {run.phases
              .filter((p) => p.outcome && (p.outcome.decision === 'block' || p.outcome.needsHuman))
              .map((phase) => (
                <div key={phase.name} className="p-3 bg-err border border-err-line rounded">
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                      phase.outcome?.decision === 'block' ? 'bg-err text-err-fg' : 'bg-progress text-progress-fg'
                    }`}>
                      {phase.outcome?.decision?.toUpperCase()}
                    </span>
                    {phase.outcome?.needsHuman && (
                      <span className="px-2 py-1 text-xs font-medium rounded-full bg-err text-err-fg">
                        NEEDS HUMAN
                      </span>
                    )}
                    <span className="font-medium text-default">{phase.name}</span>
                  </div>
                  {phase.outcome?.reason && (
                    <p className="mt-1 text-sm text-muted">{phase.outcome.reason}</p>
                  )}
                  {phase.outcome?.evidenceDigest && (
                    <p className="mt-1 text-xs text-muted font-mono">{phase.outcome.evidenceDigest}</p>
                  )}
                  {phase.outcome?.workItemContext && (
                    <p className="mt-1 text-xs text-muted">{phase.outcome.workItemContext}</p>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Evidence Table */}
      <div className="bg-surface rounded-lg border border-line">
        <EvidenceTable
          evidence={run.evidence || []}
          onRowClick={setSelectedEvidence}
        />
      </div>

      {/* Evidence Detail Modal */}
      <EvidenceDetail evidence={selectedEvidence} onClose={() => setSelectedEvidence(null)} />
    </div>
  );
}