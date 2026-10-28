import { describe, expect, it } from 'vitest';
import { countAlert, RATE_AFTER, ratingUrl } from '../../src/rating';

describe('countAlert', () => {
  it('counts each alert and waits until there have been enough', () => {
    expect(countAlert(0, false, 'done')).toEqual({ count: 1, ask: false });
    expect(countAlert(RATE_AFTER - 2, false, 'done')).toEqual({ count: RATE_AFTER - 1, ask: false });
    expect(countAlert(RATE_AFTER - 1, false, 'done')).toEqual({ count: RATE_AFTER, ask: true });
  });

  it('asks only after an agent finished, not while one is waiting for an answer', () => {
    expect(countAlert(RATE_AFTER - 1, false, 'needs-input').ask).toBe(false);
    expect(countAlert(RATE_AFTER - 1, false, 'failed').ask).toBe(false);
    expect(countAlert(RATE_AFTER + 3, false, 'done').ask).toBe(true);
  });

  it('never asks again once it has asked', () => {
    expect(countAlert(RATE_AFTER, true, 'done')).toEqual({ count: RATE_AFTER, ask: false });
  });
});

describe('ratingUrl', () => {
  it('sends VS Code to the Marketplace', () => {
    expect(ratingUrl('vscode')).toContain('marketplace.visualstudio.com');
    expect(ratingUrl('vscode-insiders')).toContain('marketplace.visualstudio.com');
  });

  it('sends Cursor, Windsurf and VSCodium to Open VSX', () => {
    for (const scheme of ['cursor', 'windsurf', 'vscodium']) expect(ratingUrl(scheme)).toContain('open-vsx.org');
  });
});
