import type { ChimeEvent } from './agents';

// Agent Chime asks for a Marketplace rating once, after it has been useful for a while, and never again.

/** Alerts played before the one request for a rating. */
export const RATE_AFTER = 20;
export const RATING_URL = 'https://marketplace.visualstudio.com/items?itemName=hamperpick.agent-chime&ssr=false#review-details';

/**
 * The alert count after this alert, and whether to ask now. Asks only after an agent finished, never while
 * one is waiting for an answer, so the request doesn't get in the way.
 */
export function countAlert(count: number, asked: boolean, state: ChimeEvent): { count: number; ask: boolean } {
  if (asked) return { count, ask: false };
  const next = count + 1;
  return { count: next, ask: next >= RATE_AFTER && state === 'done' };
}
