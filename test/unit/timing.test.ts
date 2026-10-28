import { describe, expect, it } from 'vitest';
import { formatDuration, runLength } from '../../src/timing';

describe('formatDuration', () => {
  it('writes seconds, minutes and hours the short way', () => {
    expect(formatDuration(42_000)).toBe('42s');
    expect(formatDuration(252_000)).toBe('4m 12s');
    expect(formatDuration(240_000)).toBe('4m');
    expect(formatDuration(3_900_000)).toBe('1h 5m');
    expect(formatDuration(7_200_000)).toBe('2h');
  });
});

describe('runLength', () => {
  it('counts from the start of work, through a wait for approval', () => {
    expect(runLength({ state: 'working', startedAt: 1_000 }, 61_000)).toBe(60_000);
    expect(runLength({ state: 'needs-input', startedAt: 1_000 }, 91_000)).toBe(90_000);
  });

  it('knows nothing when it never saw the start', () => {
    expect(runLength(undefined, 5_000)).toBeUndefined();
    expect(runLength({ state: 'working' }, 5_000)).toBeUndefined();
    expect(runLength({ state: 'done', startedAt: 1_000 }, 5_000)).toBeUndefined();
  });
});
