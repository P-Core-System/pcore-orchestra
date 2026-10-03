import type { RunDetail, RunPhase, RunGate, RunEvidence } from '../lib/conductorRuns';

interface RunDetailProps {
  run: RunDetail | null;
}

export function RunDetail({ run }: RunDetailProps) {
  if (!run) {
    return (
      <div className="p-8 text-center text-gray-500">
        Select a run to view details
      </div>
    );
  }

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
  };

  const getPhaseStatusClass = (status: RunPhase['status']): string => {
    switch (status) {
      case 'active': return 'bg-blue-100 text-blue-700';
      case 'completed': return 'bg-green-100 text-green-700';
      case 'failed': return 'bg-red-100 text-red-700';
      case 'skipped': return 'bg-gray-100 text-gray-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const getGateStatusClass = (status: RunGate['status']): string => {
    switch (status) {
      case 'passed': return 'bg-green-100 text-green-700';
      case 'failed': return 'bg-red-100 text-red-700';
      case 'skipped': return 'bg-gray-100 text-gray-700';
      default: return 'bg-yellow-100 text-yellow-700';
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* Run Header */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h3 className="text-xl font-bold text-gray-900">{run.goal}</h3>
            <div className="flex flex-wrap gap-4 mt-2 text-sm text-gray-500">
              <span className="font-mono">Run: {run.runId}</span>
              <span>Workspace: {run.workspace}</span>
              <span>Session: {run.sessionId}</span>
              <span>Task: {run.taskId}</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className={`px-3 py-1 text-sm font-medium rounded-full ${
              run.status === 'completed' ? 'bg-green-100 text-green-700' :
              run.status === 'failed' ? 'bg-red-100 text-red-700' :
              run.status === 'stalled' ? 'bg-yellow-100 text-yellow-700' :
              'bg-blue-100 text-blue-700'
            }`}>
              {run.status.charAt(0).toUpperCase() + run.status.slice(1).replace('_', ' ')}
            </span>
            <span className="text-sm text-gray-500">
              {formatDuration(run.durationMs || 0)}
            </span>
          </div>
        </div>
      </div>

      {/* Phases */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="p-4 border-b border-gray-200">
          <h4 className="font-semibold text-gray-900">Phases ({run.phases.length})</h4>
        </div>
        <div className="divide-y divide-gray-200">
          {run.phases.map((phase: RunPhase) => (
            <div key={phase.name} className="p-4 hover:bg-gray-50">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${getPhaseStatusClass(phase.status)}`}>
                    {phase.status.charAt(0).toUpperCase() + phase.status.slice(1)}
                  </span>
                  <span className="font-medium text-gray-900">{phase.name}</span>
                  {phase.agent && (
                    <span className="text-sm text-gray-500">{phase.agent}</span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-sm text-gray-500">
                  {phase.startedAt && <span>Started: {formatTime(phase.startedAt)}</span>}
                  {phase.completedAt && <span>Completed: {formatTime(phase.completedAt)}</span>}
                  {phase.durationMs && <span className="font-mono">Duration: {formatDuration(phase.durationMs)}</span>}
                </div>
              </div>
              {phase.outcome && (
                <div className="mt-2 p-2 bg-gray-50 rounded text-sm">
                  <span className="font-medium">Outcome:</span>{' '}
                  <span className={phase.outcome.decision === 'block' ? 'text-red-600' : phase.outcome.decision === 'fix' ? 'text-yellow-600' : 'text-green-600'}>
                    {phase.outcome.decision}
                  </span>
                  {phase.outcome.reason && <span className="ml-2 text-gray-500">- {phase.outcome.reason}</span>}
                  {phase.outcome.needsHuman && <span className="ml-2 text-red-600 font-medium">⚠ Needs Human</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Gates */}
      {run.gates && run.gates.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="p-4 border-b border-gray-200">
            <h4 className="font-semibold text-gray-900">Gates ({run.gates.length})</h4>
          </div>
          <div className="divide-y divide-gray-200">
            {run.gates.map((gate: RunGate) => (
              <div key={gate.name} className="p-4 hover:bg-gray-50">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${getGateStatusClass(gate.status)}`}>
                      {gate.status.charAt(0).toUpperCase() + gate.status.slice(1)}
                    </span>
                    <span className="font-medium text-gray-900">{gate.name}</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-500">
                    {gate.exitCode !== undefined && (
                      <span className={`font-mono ${gate.exitCode === 0 ? 'text-green-600' : 'text-red-600'}`}>
                        Exit: {gate.exitCode}
                      </span>
                    )}
                    {gate.durationMs && <span className="font-mono">{formatDuration(gate.durationMs)}</span>}
                    {gate.command && <span className="font-mono text-xs truncate max-w-xs" title={gate.command}>{gate.command}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Evidence Summary */}
      {run.evidence && run.evidence.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="p-4 border-b border-gray-200">
            <h4 className="font-semibold text-gray-900">Evidence Summary ({run.evidence.length})</h4>
          </div>
          <div className="divide-y divide-gray-200">
            {run.evidence.slice(0, 5).map((evidence: RunEvidence, idx) => (
              <div key={idx} className="p-4 hover:bg-gray-50">
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${evidence.ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {evidence.ok ? 'PASS' : 'FAIL'}
                  </span>
                  <span className="font-medium text-gray-900">{evidence.gate}</span>
                  <span className="text-sm text-gray-500 font-mono">{formatDuration(evidence.durationMs)}</span>
                </div>
              </div>
            ))}
            {run.evidence.length > 5 && (
              <div className="p-4 text-center text-gray-500 text-sm">
                +{run.evidence.length - 5} more evidence records
              </div>
            )}
          </div>
        </div>
      )}

      {/* Handoff */}
      {run.handoff && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h4 className="font-semibold text-gray-900 mb-2">Handoff Digest</h4>
          <div className="bg-gray-50 rounded p-3 text-sm">
            <div className="mb-2"><span className="font-medium">From:</span> {run.handoff.fromPhase} → <span className="font-medium">To:</span> {run.handoff.toPhase}</div>
            <div className="mb-2"><span className="font-medium">Evidence:</span> {run.handoff.evidenceDigest}</div>
            <div className="mb-2"><span className="font-medium">Work Item:</span> {run.handoff.workItemContext}</div>
            <div><span className="font-medium">Time:</span> {formatTime(run.handoff.timestamp)} {run.handoff.clamped && '(clamped)'}</div>
          </div>
        </div>
      )}

      {/* Tokens */}
      {run.tokens && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h4 className="font-semibold text-gray-900 mb-2">Token Usage</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-gray-500">Total:</span> <span className="font-mono ml-2">{run.tokens.total}</span></div>
            <div><span className="text-gray-500">Budget:</span> <span className="font-mono ml-2">{run.tokens.budget}</span></div>
            <div className="col-span-2">
              <span className="text-gray-500">By Agent:</span>
              <ul className="ml-4 mt-1 space-y-1">
                {run.tokens.byAgent.map((a) => (
                  <li key={a.agent} className="flex justify-between">
                    <span>{a.agent}</span>
                    <span className="font-mono">{a.total} / {a.budget} {a.overBudget ? '(OVER)' : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}