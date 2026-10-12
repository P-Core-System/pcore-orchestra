import type { RunEvidence } from '../lib/conductorRuns';

interface EvidenceDetailProps {
  evidence: RunEvidence | null;
  onClose: () => void;
}

export function EvidenceDetail({ evidence, onClose }: EvidenceDetailProps) {
  if (!evidence) return null;

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
    return `${(ms / 1000).toFixed(2)}s`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-surface rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-line flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-default">Evidence Detail: {evidence.gate}</h3>
            <p className="text-sm text-muted mt-1">
              {formatTime(evidence.startedAt)} · Duration: {formatDuration(evidence.durationMs)} ·{' '}
              <span className={evidence.ok ? 'text-ok-fg' : 'text-err-fg'}>
                {evidence.ok ? 'PASSED' : 'FAILED'}
              </span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-muted hover:text-muted hover:bg-sunken rounded-lg transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 space-y-6">
          {/* Command */}
          <div>
            <h4 className="font-medium text-default mb-2">Command</h4>
            <div className="bg-code text-code-ok p-4 rounded font-mono text-sm overflow-x-auto whitespace-pre-wrap">
              {evidence.command} {evidence.args.join(' ')}
            </div>
            <div className="mt-2 text-xs text-muted">
              CWD: {evidence.cwd}
            </div>
          </div>

          {/* Exit Info */}
          <div className="grid grid-cols-3 gap-4">
            <div className="p-3 bg-sunken rounded">
              <p className="text-xs text-muted">Exit Code</p>
              <p className="font-mono text-lg font-semibold {evidence.exitCode === 0 ? 'text-ok-fg' : 'text-err-fg'}">
                {evidence.exitCode}
              </p>
            </div>
            <div className="p-3 bg-sunken rounded">
              <p className="text-xs text-muted">Duration</p>
              <p className="font-mono text-lg">{formatDuration(evidence.durationMs)}</p>
            </div>
            <div className="p-3 bg-sunken rounded">
              <p className="text-xs text-muted">Started</p>
              <p className="font-mono text-sm">{formatTime(evidence.startedAt)}</p>
            </div>
          </div>

          {/* Details */}
          {evidence.details && (
            <div>
              <h4 className="font-medium text-default mb-2">Details</h4>
              <div className="bg-sunken p-4 rounded text-sm text-muted whitespace-pre-wrap">
                {evidence.details}
              </div>
            </div>
          )}

          {/* Stdout */}
          <div>
            <h4 className="font-medium text-default mb-2">Stdout</h4>
            <div className="bg-code text-code-text p-4 rounded font-mono text-sm overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
              {evidence.stdoutExcerpt || '(empty)'}
            </div>
          </div>

          {/* Stderr */}
          <div>
            <h4 className="font-medium text-default mb-2">Stderr</h4>
            <div className="bg-code text-code-err p-4 rounded font-mono text-sm overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
              {evidence.stderrExcerpt || '(empty)'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}