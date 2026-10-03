/**
 * Small pure formatters shared by the graph side panel and the run timeline.
 * No DOM, no clock reads beyond the values passed in — safe to unit test.
 */

/** Spec §5: evidence excerpt = first ~10 lines, clamped with an "expand" hint. */
export const EXCERPT_LINES = 10;

export function clampExcerpt(text: unknown, maxLines: number = EXCERPT_LINES): string {
  if (typeof text !== 'string' || text.length === 0) return '';
  const lines = text.split(/\r?\n/);
  if (lines.length <= maxLines) return text;
  const hidden = lines.length - maxLines;
  return `${lines.slice(0, maxLines).join('\n')}\n… (+${hidden} more lines)`;
}

/** `1234` → `1.2s`, `65_000` → `1m 05s`. */
export function formatDuration(ms: unknown): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** Board card age — `45s`, `12m`, `3h`, `2d`. */
export function formatAge(ms: unknown): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** `1712345678901` → `2026-10-03 09:00` (local), tolerant of junk input. */
export function formatTimestamp(value: unknown): string {
  const ms =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Date.parse(value)
        : NaN;
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
