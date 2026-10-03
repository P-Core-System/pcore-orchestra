interface ReviewItemProps {
  item: {
    ticketId: string;
    phase: string;
    reason: string;
    since: number;
    runId: string;
    needsHuman: boolean;
  };
  onClick: () => void;
}

export function ReviewItem({ item, onClick }: ReviewItemProps) {
  const formatRelativeTime = (timestamp: number): string => {
    const now = Date.now();
    const diffMs = now - timestamp;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  return (
    <div
      onClick={onClick}
      className="p-4 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-blue-300 cursor-pointer transition-colors"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <span className="font-mono text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
              {item.ticketId.slice(0, 12)}
            </span>
            <span className="text-sm font-medium text-gray-900">{item.phase}</span>
            {item.needsHuman && (
              <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full">
                NEEDS HUMAN
              </span>
            )}
          </div>
          <p className="text-sm text-gray-600 mb-2">{item.reason || 'No reason provided'}</p>
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span>Run: <span className="font-mono">{item.runId.slice(0, 12)}</span></span>
            <span>{formatRelativeTime(item.since)}</span>
          </div>
        </div>
        <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </div>
  );
}