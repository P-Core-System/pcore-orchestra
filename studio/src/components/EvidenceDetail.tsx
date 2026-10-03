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
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Evidence Detail: {evidence.gate}</h3>
            <p className="text-sm text-gray-500 mt-1">
              {formatTime(evidence.startedAt)} · Duration: {formatDuration(evidence.durationMs)} ·{' '}
              <span className={evidence.ok ? 'text-green-600' : 'text-red-600'}>
                {evidence.ok ? 'PASSED' : 'FAILED'}
              </span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 space-y-6">
          {/* Command */}
          <div>
            <h4 className="font-medium text-gray-900 mb-2">Command</h4>
            <div className="bg-gray-900 text-green-300 p-4 rounded font-mono text-sm overflow-x-auto whitespace-pre-wrap">
              {evidence.command} {evidence.args.join(' ')}
            </div>
            <div className="mt-2 text-xs text-gray-500">
              CWD: {evidence.cwd}
            </div>
          </div>

          {/* Exit Info */}
          <div className="grid grid-cols-3 gap-4">
            <div className="p-3 bg-gray-50 rounded">
              <p className="text-xs text-gray-500">Exit Code</p>
              <p className="font-mono text-lg font-semibold {evidence.exitCode === 0 ? 'text-green-600' : 'text-red-600'}">
                {evidence.exitCode}
              </p>
            </div>
            <div className="p-3 bg-gray-50 rounded">
              <p className="text-xs text-gray-500">Duration</p>
              <p className="font-mono text-lg">{formatDuration(evidence.durationMs)}</p>
            </div>
            <div className="p-3 bg-gray-50 rounded">
              <p className="text-xs text-gray-500">Started</p>
              <p className="font-mono text-sm">{formatTime(evidence.startedAt)}</p>
            </div>
          </div>

          {/* Details */}
          {evidence.details && (
            <div>
              <h4 className="font-medium text-gray-900 mb-2">Details</h4>
              <div className="bg-gray-50 p-4 rounded text-sm text-gray-700 whitespace-pre-wrap">
                {evidence.details}
              </div>
            </div>
          )}

          {/* Stdout */}
          <div>
            <h4 className="font-medium text-gray-900 mb-2">Stdout</h4>
            <div className="bg-gray-900 text-gray-100 p-4 rounded font-mono text-sm overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
              {evidence.stdoutExcerpt || '(empty)'}
            </div>
          </div>

          {/* Stderr */}
          <div>
            <h4 className="font-medium text-gray-900 mb-2">Stderr</h4>
            <div className="bg-gray-900 text-red-300 p-4 rounded font-mono text-sm overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
              {evidence.stderrExcerpt || '(empty)'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}