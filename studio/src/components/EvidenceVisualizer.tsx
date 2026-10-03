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
      <div className="p-8 text-center text-gray-500">
        Select a run to view evidence
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Handoff Digest */}
      {run.handoff && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900 mb-3">Handoff Digest</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-gray-500">From Phase</p>
              <p className="font-medium text-gray-900">{run.handoff.fromPhase}</p>
            </div>
            <div>
              <p className="text-gray-500">To Phase</p>
              <p className="font-medium text-gray-900">{run.handoff.toPhase}</p>
            </div>
            <div>
              <p className="text-gray-500">Timestamp</p>
              <p className="font-medium text-gray-900">{new Date(run.handoff.timestamp).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-gray-500">Clamped</p>
              <p className="font-medium text-gray-900">{run.handoff.clamped ? 'Yes' : 'No'}</p>
            </div>
          </div>
          <div className="mt-4">
            <p className="text-gray-500 text-sm mb-1">Evidence Digest</p>
            <p className="bg-gray-50 p-3 rounded text-sm font-mono text-gray-700 whitespace-pre-wrap">
              {run.handoff.evidenceDigest}
            </p>
          </div>
          <div className="mt-4">
            <p className="text-gray-500 text-sm mb-1">Work Item Context</p>
            <p className="bg-gray-50 p-3 rounded text-sm text-gray-700 whitespace-pre-wrap">
              {run.handoff.workItemContext}
            </p>
          </div>
        </div>
      )}

      {/* Phase Outcomes with block/needs_human */}
      {run.phases.some((p) => p.outcome && (p.outcome.decision === 'block' || p.outcome.needsHuman)) && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900 mb-3 text-red-600">Phase Blocks / Needs Human</h3>
          <div className="space-y-3">
            {run.phases
              .filter((p) => p.outcome && (p.outcome.decision === 'block' || p.outcome.needsHuman))
              .map((phase) => (
                <div key={phase.name} className="p-3 bg-red-50 border border-red-200 rounded">
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                      phase.outcome?.decision === 'block' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {phase.outcome?.decision?.toUpperCase()}
                    </span>
                    {phase.outcome?.needsHuman && (
                      <span className="px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-700">
                        NEEDS HUMAN
                      </span>
                    )}
                    <span className="font-medium text-gray-900">{phase.name}</span>
                  </div>
                  {phase.outcome?.reason && (
                    <p className="mt-1 text-sm text-gray-600">{phase.outcome.reason}</p>
                  )}
                  {phase.outcome?.evidenceDigest && (
                    <p className="mt-1 text-xs text-gray-500 font-mono">{phase.outcome.evidenceDigest}</p>
                  )}
                  {phase.outcome?.workItemContext && (
                    <p className="mt-1 text-xs text-gray-500">{phase.outcome.workItemContext}</p>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Evidence Table */}
      <div className="bg-white rounded-lg border border-gray-200">
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