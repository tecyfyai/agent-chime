import * as assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { AgentChimeApi, HandledNotice } from '../../src/extension';
import { hookScriptPath } from '../../src/paths';

let api: AgentChimeApi;
const opened: vscode.Terminal[] = [];

async function openTerminal(name: string): Promise<vscode.Terminal> {
  const terminal = vscode.window.createTerminal({ name });
  opened.push(terminal);
  const pid = await terminal.processId;
  assert.ok(pid, `terminal "${name}" has a shell`);
  return terminal;
}

/** Waits for the next report the extension handles that matches. */
function nextNotice(match: (handled: HandledNotice) => boolean, timeoutMs = 20_000): Promise<HandledNotice> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      subscription.dispose();
      reject(new Error('no report arrived in time'));
    }, timeoutMs);
    const subscription = api.onDidHandleNotice((handled) => {
      if (!match(handled)) return;
      clearTimeout(timer);
      subscription.dispose();
      resolve(handled);
    });
  });
}

/** Runs the hook script inside a terminal, the way an agent started there would. */
function runHook(terminal: vscode.Terminal, agent: string, event: string, json: object): void {
  const payload = JSON.stringify(json).replace(/'/g, `'\\''`);
  terminal.sendText(`printf '%s' '${payload}' | sh '${hookScriptPath()}' ${agent} ${event}`);
}

suite('Agent Chime in VS Code', () => {
  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension<AgentChimeApi>('hamperpick.agent-chime');
    assert.ok(extension, 'the extension is installed');
    api = await extension.activate();
  });

  suiteTeardown(() => {
    for (const terminal of opened) terminal.dispose();
  });

  test('installs the hook script and registers the window', () => {
    assert.ok(fs.existsSync(hookScriptPath()));
    const windows = fs.readdirSync(path.join(path.dirname(hookScriptPath()), 'windows'));
    assert.equal(windows.filter((name) => name.endsWith('.window')).length, 1);
  });

  test('matches each report to the terminal it came from', async () => {
    const first = await openTerminal('first');
    const second = await openTerminal('second');

    const fromSecond = nextNotice((handled) => handled.notice.agent === 'codex');
    runHook(second, 'codex', 'needs-input', { tool_name: 'Bash', tool_input: { command: 'npm test' } });
    const codex = await fromSecond;
    assert.equal(codex.terminal, second);
    assert.equal(codex.notice.state, 'needs-input');
    assert.equal(codex.notice.detail, 'npm test');

    const fromFirst = nextNotice((handled) => handled.notice.agent === 'claude');
    runHook(first, 'claude', 'done', { last_assistant_message: 'Finished the refactor' });
    const claude = await fromFirst;
    assert.equal(claude.terminal, first);
    assert.equal(claude.notice.detail, 'Finished the refactor');
  });

  test('says nothing for work that is only starting', async () => {
    const terminal = await openTerminal('working');
    const started = nextNotice((handled) => handled.terminal === terminal);
    runHook(terminal, 'claude', 'working', { prompt: 'fix the bug' });
    const handled = await started;
    assert.equal(handled.notice.state, 'working');
    assert.equal(handled.alerted, false);
  });

  test('ignores agents running outside this window', async () => {
    const outside = nextNotice((handled) => handled.notice.detail === 'elsewhere');
    // Run the script from the extension host, which is not inside any terminal.
    const child = execFile('sh', [hookScriptPath(), 'claude', 'done']);
    child.stdin!.end(JSON.stringify({ last_assistant_message: 'elsewhere' }));
    const handled = await outside;
    assert.equal(handled.terminal, undefined);
    assert.equal(handled.alerted, false);
  });
});
