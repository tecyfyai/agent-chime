import type { ChimeEvent } from './agents';

/** A run's length to the second, such as "42s", "4m 12s" or "1h 5m". */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 === 0 ? `${minutes}m` : `${minutes}m ${seconds % 60}s`;
  return minutes % 60 === 0 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * How long the run that ends now took, when Agent Chime saw it start: from the last "working" report,
 * through any wait for your approval.
 */
export function runLength(previous: { state: ChimeEvent; startedAt?: number } | undefined, now: number): number | undefined {
  if (previous?.startedAt === undefined) return undefined;
  if (previous.state !== 'working' && previous.state !== 'needs-input') return undefined;
  return now - previous.startedAt;
}
