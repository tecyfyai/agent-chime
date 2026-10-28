import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentNotice } from '../../src/events';
import { installHookScript } from '../../src/hookScript';
import { Listener, pruneClosedWindows } from '../../src/listener';
import { ancestors, listProcesses, parseProcessList } from '../../src/processTree';

function runHook(script: string, args: string[], input: string, env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = execFile('sh', [script, ...args], { env }, (error, stdout) =>
      resolve({ code: error ? Number(error.code ?? 1) : 0, stdout }),
    );
    child.stdin!.end(input);
  });
}

describe('the hook script and the listener together', () => {
  let home: string;
  let env: NodeJS.ProcessEnv;
  const listeners: Listener[] = [];

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chime-'));
    process.env.AGENT_CHIME_HOME = home;
    env = { ...process.env, AGENT_CHIME_HOME: home };
  });

  afterEach(() => {
    for (const listener of listeners.splice(0)) listener.dispose();
    delete process.env.AGENT_CHIME_HOME;
    fs.rmSync(home, { recursive: true, force: true });
  });

  async function startListener(onNotice: (notice: AgentNotice) => Promise<void>): Promise<Listener> {
    const listener = new Listener(onNotice);
    await listener.start();
    listeners.push(listener);
    return listener;
  }

  it('delivers the hook JSON to every open window, while the script is still running', async () => {
    const script = installHookScript();
    expect(fs.statSync(script).mode & 0o111).not.toBe(0);

    const received: { notice: AgentNotice; chain: number[] }[] = [];
    const onNotice = async (notice: AgentNotice) => {
      received.push({ notice, chain: ancestors(notice.pid, await listProcesses()) });
    };
    await startListener(onNotice);
    await startListener(onNotice);

    const body = JSON.stringify({ session_id: 's1', last_assistant_message: 'All tests pass' });
    const result = await runHook(script, ['claude', 'done'], body, env);

    expect(result).toEqual({ code: 0, stdout: '' });
    expect(received).toHaveLength(2);
    for (const { notice, chain } of received) {
      expect(notice).toMatchObject({ agent: 'claude', state: 'done', sessionId: 's1', detail: 'All tests pass' });
      // The script is still alive while the window looks, and runs under this test's process, the way
      // an agent runs under a terminal's shell.
      expect(chain).toContain(process.pid);
    }
  });

  it('exits quietly when no window is open, or the folder is missing', async () => {
    const script = installHookScript();
    expect(await runHook(script, ['codex', 'done'], '{}', env)).toEqual({ code: 0, stdout: '' });
    fs.rmSync(path.join(home, 'windows'), { recursive: true, force: true });
    expect(await runHook(script, ['codex', 'done'], '{}', env)).toEqual({ code: 0, stdout: '' });
  });

  it('answers Antigravity CLI and Cursor with JSON that lets them carry on, even with no window open', async () => {
    const script = installHookScript();
    for (const dir of [true, false]) {
      if (!dir) fs.rmSync(path.join(home, 'windows'), { recursive: true, force: true });
      expect(await runHook(script, ['antigravity', 'working'], '{}', env)).toEqual({ code: 0, stdout: '{}' });
      expect(await runHook(script, ['antigravity', 'done'], '{}', env)).toEqual({ code: 0, stdout: '{"decision":"stop"}' });
      expect(await runHook(script, ['cursor', 'working'], '{}', env)).toEqual({ code: 0, stdout: '{"continue":true}' });
      expect(await runHook(script, ['cursor', 'done'], '{}', env)).toEqual({ code: 0, stdout: '{}' });
    }
  });

  it('passes on only the first Antigravity model call of a prompt', async () => {
    const script = installHookScript();
    const received: AgentNotice[] = [];
    await startListener(async (notice) => {
      received.push(notice);
    });
    await runHook(script, ['antigravity', 'working'], '{"conversationId":"a1","invocationNum":3,"initialNumSteps":5}', env);
    expect(received).toHaveLength(0);
    await runHook(script, ['antigravity', 'working'], '{"conversationId":"a1","initialNumSteps":1,"invocationNum":0,"modelName":"m"}', env);
    expect(received.map((notice) => notice.state)).toEqual(['working']);
  });

  it('skips windows that have closed and refuses reports without the token', async () => {
    const script = installHookScript();
    const received: AgentNotice[] = [];
    await startListener(async (notice) => {
      received.push(notice);
    });
    const windows = path.join(home, 'windows');
    // A window that closed without cleaning up: nothing listens on its port.
    fs.writeFileSync(path.join(windows, '999999-1.window'), '1 deadbeef\n');
    // A window file with the wrong token for a live port.
    const [live] = fs.readdirSync(windows).filter((name) => name.startsWith(`${process.pid}-`));
    const port = /-(\d+)\.window$/.exec(live!)![1];
    fs.writeFileSync(path.join(windows, `${process.pid}-0.window`), `${port} wrong-token\n`);

    const started = Date.now();
    expect((await runHook(script, ['codex', 'needs-input'], '{"tool_name":"Bash"}', env)).code).toBe(0);
    expect(Date.now() - started).toBeLessThan(2_500);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ agent: 'codex', state: 'needs-input', detail: 'Wants to use Bash' });

    pruneClosedWindows(windows);
    expect(fs.existsSync(path.join(windows, '999999-1.window'))).toBe(false);
    expect(fs.existsSync(path.join(windows, live!))).toBe(true);
  });

  it('removes its window file when it closes', async () => {
    const listener = await startListener(async () => {});
    expect(fs.readdirSync(path.join(home, 'windows'))).toHaveLength(1);
    listener.dispose();
    expect(fs.readdirSync(path.join(home, 'windows'))).toHaveLength(0);
  });

  it('rewrites an outdated script but leaves a current one alone', () => {
    const script = installHookScript();
    fs.writeFileSync(script, '#!/bin/sh\n# old\n');
    installHookScript();
    expect(fs.readFileSync(script, 'utf8')).toContain('Agent Chime hook');
    const before = fs.statSync(script).mtimeMs;
    installHookScript();
    expect(fs.statSync(script).mtimeMs).toBe(before);
  });
});

describe('process tree', () => {
  it('walks from a process up to the first one', () => {
    const parents = parseProcessList('  1     0\n 300     1\n 4000   300\n garbage\n4100  4000\n');
    expect(ancestors(4100, parents)).toEqual([4100, 4000, 300, 1]);
    expect(ancestors(77, parents)).toEqual([77]);
  });

  it('stops on a loop instead of spinning', () => {
    const parents = new Map([
      [10, 11],
      [11, 10],
    ]);
    expect(ancestors(10, parents)).toEqual([10, 11]);
  });
});
