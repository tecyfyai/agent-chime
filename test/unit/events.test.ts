import { describe, expect, it } from 'vitest';
import { readNotice, sameFolders, summarize } from '../../src/events';

const query = (agent: string, event: string, pid = '4242') => new URLSearchParams({ agent, event, pid });

describe('readNotice', () => {
  it('reads a Claude Code Stop hook', () => {
    const body = JSON.stringify({
      session_id: 'abc123',
      hook_event_name: 'Stop',
      last_assistant_message: "## Done\n\nI've completed the refactoring. Here's a summary...",
    });
    expect(readNotice(query('claude', 'done'), body)).toEqual({
      agent: 'claude',
      state: 'done',
      pid: 4242,
      sessionId: 'abc123',
      detail: 'Done',
    });
  });

  it('uses the message of a Claude Code permission notification', () => {
    const body = JSON.stringify({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' });
    expect(readNotice(query('claude', 'needs-input'), body)?.detail).toBe('Claude needs your permission to use Bash');
  });

  it('describes a Codex permission request from its tool', () => {
    const withDescription = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'rm -rf build', description: 'Clean the build folder' } });
    expect(readNotice(query('codex', 'needs-input'), withDescription)?.detail).toBe('Clean the build folder');
    const withCommand = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm test' } });
    expect(readNotice(query('codex', 'needs-input'), withCommand)?.detail).toBe('npm test');
    const toolOnly = JSON.stringify({ tool_name: 'apply_patch', tool_input: {} });
    expect(readNotice(query('codex', 'needs-input'), toolOnly)?.detail).toBe('Wants to use apply_patch');
  });

  it('still reports when the hook sent no JSON', () => {
    expect(readNotice(query('codex', 'done'), '')).toEqual({ agent: 'codex', state: 'done', pid: 4242, sessionId: undefined, detail: undefined });
    expect(readNotice(query('codex', 'done'), 'not json')?.state).toBe('done');
  });

  it('ignores reports it does not understand', () => {
    expect(readNotice(query('aider', 'done'), '')).toBeUndefined();
    expect(readNotice(query('claude', 'exploded'), '')).toBeUndefined();
    expect(readNotice(query('claude', 'done', 'abc'), '')).toBeUndefined();
    expect(readNotice(query('claude', 'done', '1'), '')).toBeUndefined();
    expect(readNotice(query('constructor', 'done'), '')).toBeUndefined();
  });
});

describe('summarize', () => {
  it('takes the first line with words in it and shortens it', () => {
    expect(summarize('\n\n> **Note**: all tests pass\nmore')).toBe('**Note**: all tests pass');
    const long = 'word '.repeat(60);
    const short = summarize(long)!;
    expect(short.length).toBeLessThanOrEqual(140);
    expect(short.endsWith('…')).toBe(true);
    expect(summarize('   \n  ')).toBeUndefined();
    expect(summarize(undefined)).toBeUndefined();
  });
});

describe('Antigravity CLI and Cursor reports', () => {
  it('reads how an Antigravity CLI run ended', () => {
    // As Antigravity CLI 1.4.2 sends it.
    const done = JSON.stringify({ conversationId: 'a1', error: '', executionNum: 0, fullyIdle: true, terminationReason: 'NO_TOOL_CALL' });
    expect(readNotice(query('antigravity', 'done'), done)).toMatchObject({ agent: 'antigravity', state: 'done', sessionId: 'a1', detail: undefined });
    const crashed = JSON.stringify({ conversationId: 'a1', error: 'quota exceeded', terminationReason: 'error' });
    expect(readNotice(query('antigravity', 'done'), crashed)).toMatchObject({ state: 'failed', detail: 'quota exceeded' });
  });

  it('reads how a Cursor run ended and where it ran', () => {
    const done = JSON.stringify({ conversation_id: 'c1', status: 'completed', workspace_roots: ['/work/app'] });
    expect(readNotice(query('cursor', 'done'), done)).toMatchObject({ state: 'done', sessionId: 'c1', workspaceRoots: ['/work/app'] });
    expect(readNotice(query('cursor', 'done'), done)?.stoppedByYou).toBeUndefined();
    expect(readNotice(query('cursor', 'done'), JSON.stringify({ status: 'error' }))?.state).toBe('failed');
    expect(readNotice(query('cursor', 'done'), JSON.stringify({ status: 'aborted' }))?.stoppedByYou).toBe(true);
  });
});

describe('sameFolders', () => {
  it('compares folder lists in any order, ignoring a trailing slash', () => {
    expect(sameFolders(['/work/app/', '/work/lib'], ['/work/lib', '/work/app'])).toBe(true);
    expect(sameFolders(['/work/app'], ['/work/app', '/work/lib'])).toBe(false);
    expect(sameFolders(['/work/app'], ['/work/other'])).toBe(false);
    expect(sameFolders([], [])).toBe(true);
  });
});
