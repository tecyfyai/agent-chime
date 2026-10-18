import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addChimeHooks, connect, ConfigError, disconnect, hasChimeHooks, hookCommand, isConnected, removeChimeHooks } from '../../src/agents';

const SCRIPT = '/Users/someone/.agent-chime/hook.sh';

describe('addChimeHooks', () => {
  it('adds Claude Code hooks to an empty file', () => {
    const result = JSON.parse(addChimeHooks('', 'claude', SCRIPT));
    expect(Object.keys(result.hooks)).toEqual(['UserPromptSubmit', 'Stop', 'StopFailure', 'Notification']);
    expect(result.hooks.Stop).toEqual([
      { hooks: [{ type: 'command', command: `sh '${SCRIPT}' claude done`, async: true, timeout: 10 }] },
    ]);
    expect(result.hooks.Notification[0].matcher).toBe('permission_prompt|elicitation_dialog|agent_needs_input');
  });

  it('adds Codex hooks without the async option Codex does not have', () => {
    const result = JSON.parse(addChimeHooks('{}', 'codex', SCRIPT));
    expect(Object.keys(result.hooks)).toEqual(['UserPromptSubmit', 'Stop', 'PermissionRequest']);
    expect(result.hooks.PermissionRequest[0].hooks[0]).toEqual({
      type: 'command',
      command: `sh '${SCRIPT}' codex needs-input`,
      timeout: 10,
    });
  });

  it('keeps the other settings and hooks, comments and indentation', () => {
    const before = `{
    // my settings
    "model": "opus",
    "hooks": {
        "Stop": [
            { "hooks": [{ "type": "command", "command": "say done" }] }
        ],
        "PreToolUse": [
            { "matcher": "Bash", "hooks": [{ "type": "command", "command": "check.sh" }] }
        ]
    }
}`;
    const after = addChimeHooks(before, 'claude', SCRIPT);
    expect(after).toContain('// my settings');
    expect(after).toContain('\n    "model": "opus"');
    const parsed = JSON.parse(after.replace('// my settings', ''));
    expect(parsed.model).toBe('opus');
    expect(parsed.hooks.PreToolUse).toEqual([{ matcher: 'Bash', hooks: [{ type: 'command', command: 'check.sh' }] }]);
    expect(parsed.hooks.Stop).toHaveLength(2);
    expect(parsed.hooks.Stop[0].hooks[0].command).toBe('say done');
    expect(parsed.hooks.Stop[1].hooks[0].command).toContain('claude done');
  });

  it('replaces its own hooks instead of adding them twice', () => {
    const once = addChimeHooks('{}', 'claude', SCRIPT);
    const twice = addChimeHooks(once, 'claude', SCRIPT);
    expect(twice).toBe(once);
    const moved = JSON.parse(addChimeHooks(once, 'claude', '/elsewhere/.agent-chime/hook.sh'));
    expect(moved.hooks.Stop).toHaveLength(1);
    expect(moved.hooks.Stop[0].hooks[0].command).toContain('/elsewhere/');
  });

  it('quotes a script path that has spaces or quotes in it', () => {
    expect(hookCommand("/Users/o'neil/my files/.agent-chime/hook.sh", 'claude', 'done')).toBe(
      `sh '/Users/o'\\''neil/my files/.agent-chime/hook.sh' claude done`,
    );
  });

  it('refuses a file it cannot read rather than overwrite it', () => {
    expect(() => addChimeHooks('{ "model": ', 'claude', SCRIPT)).toThrow(ConfigError);
    expect(() => addChimeHooks('{ "hooks": [] }', 'claude', SCRIPT)).toThrow(ConfigError);
    expect(() => addChimeHooks('[]', 'claude', SCRIPT)).toThrow(ConfigError);
  });
});

describe('removeChimeHooks', () => {
  it('leaves a file exactly as it was before connecting', () => {
    const before = `{
  "model": "opus",
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "say done"
          }
        ]
      }
    ]
  }
}
`;
    expect(removeChimeHooks(addChimeHooks(before, 'claude', SCRIPT))).toBe(before);
  });

  it('drops the hooks object when only its own hooks were in it', () => {
    const result = removeChimeHooks(addChimeHooks('{ "model": "opus" }', 'claude', SCRIPT));
    expect(JSON.parse(result)).toEqual({ model: 'opus' });
  });

  it('keeps someone else’s hook that shares a group with one of its own', () => {
    const shared = JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              { type: 'command', command: `sh '${SCRIPT}' claude done` },
              { type: 'command', command: 'say done' },
            ],
          },
        ],
      },
    });
    expect(JSON.parse(removeChimeHooks(shared))).toEqual({
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] },
    });
  });
});

describe('hasChimeHooks', () => {
  it('tells connected files from others', () => {
    expect(hasChimeHooks(addChimeHooks('{}', 'codex', SCRIPT))).toBe(true);
    expect(hasChimeHooks('{ "hooks": { "Stop": [{ "hooks": [{ "command": "hook.sh" }] }] } }')).toBe(false);
    expect(hasChimeHooks('not json')).toBe(false);
  });
});

describe('connect and disconnect', () => {
  let dir: string;
  const saved = { ...process.env };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chime-'));
    process.env.CLAUDE_CONFIG_DIR = path.join(dir, 'claude');
    process.env.CODEX_HOME = path.join(dir, 'codex');
  });

  afterEach(() => {
    process.env = { ...saved };
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates the settings file when there is none, and keeps no backup of nothing', () => {
    expect(connect('codex', SCRIPT)).toBe(true);
    const file = path.join(dir, 'codex', 'hooks.json');
    expect(isConnected('codex')).toBe(true);
    expect(fs.existsSync(`${file}.agent-chime-backup`)).toBe(false);
    expect(connect('codex', SCRIPT)).toBe(false);
  });

  it('backs up the original once and restores its content on disconnect', () => {
    const file = path.join(dir, 'claude', 'settings.json');
    fs.mkdirSync(path.dirname(file));
    const original = '{\n  "model": "opus"\n}\n';
    fs.writeFileSync(file, original);

    expect(connect('claude', SCRIPT)).toBe(true);
    expect(fs.readFileSync(`${file}.agent-chime-backup`, 'utf8')).toBe(original);
    expect(isConnected('claude')).toBe(true);
    expect(isConnected('codex')).toBe(false);

    expect(disconnect('claude')).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
    expect(disconnect('claude')).toBe(false);
    expect(fs.readdirSync(path.dirname(file)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});
