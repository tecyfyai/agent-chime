import * as fs from 'node:fs';
import * as path from 'node:path';
import { applyEdits, modify, parse, printParseErrorCode, type FormattingOptions, type ParseError } from 'jsonc-parser';
import { claudeSettingsPath, codexHooksPath, antigravityHooksPath, cursorHooksPath } from './paths';

export type AgentId = 'claude' | 'codex' | 'antigravity' | 'cursor';

/** What the hook script reports to the window; see events.ts. */
export type ChimeEvent = 'working' | 'done' | 'failed' | 'needs-input';

interface HookSpec {
  /** The agent's own name for the hook event. */
  event: string;
  matcher?: string;
  chimeEvent: ChimeEvent;
}

export interface AgentInfo {
  id: AgentId;
  name: string;
  /** The JSON file whose `hooks` object Agent Chime adds to. */
  configFile: () => string;
  hooks: HookSpec[];
  /** Extra fields for each hook entry. */
  hookOptions: Record<string, unknown>;
  /**
   * How the file holds hooks. `groups` (Claude Code, Codex): `hooks.<event>` lists `{ matcher, hooks: [{ command }] }`.
   * `flat` (Cursor): `hooks.<event>` lists `{ command }`. `named` (Antigravity CLI): each top-level key names a set
   * of hooks, `{ enabled, <event>: [{ command }] }`, so Agent Chime keeps all of its own under one name.
   */
  layout?: 'groups' | 'flat' | 'named';
  /** Top-level fields the file must have, added when missing. */
  required?: Record<string, unknown>;
}

export const AGENTS: Record<AgentId, AgentInfo> = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    configFile: claudeSettingsPath,
    hooks: [
      { event: 'UserPromptSubmit', chimeEvent: 'working' },
      { event: 'Stop', chimeEvent: 'done' },
      { event: 'StopFailure', chimeEvent: 'failed' },
      {
        event: 'Notification',
        matcher: 'permission_prompt|elicitation_dialog|agent_needs_input',
        chimeEvent: 'needs-input',
      },
    ],
    // Run in the background so Claude never waits for the sound.
    hookOptions: { async: true, timeout: 10 },
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    configFile: codexHooksPath,
    hooks: [
      { event: 'UserPromptSubmit', chimeEvent: 'working' },
      { event: 'Stop', chimeEvent: 'done' },
      { event: 'PermissionRequest', chimeEvent: 'needs-input' },
    ],
    hookOptions: { timeout: 10 },
  },
  antigravity: {
    id: 'antigravity',
    name: 'Antigravity CLI',
    configFile: antigravityHooksPath,
    // PreInvocation fires before every model call; the hook script passes on only the first of each prompt.
    // Antigravity has no hook for "waiting for your approval".
    hooks: [
      { event: 'PreInvocation', chimeEvent: 'working' },
      { event: 'Stop', chimeEvent: 'done' },
    ],
    hookOptions: { timeout: 10 },
    layout: 'named',
  },
  cursor: {
    id: 'cursor',
    name: 'Cursor Agent',
    configFile: cursorHooksPath,
    // Cursor has no hook for "waiting for your approval", so its agent only reports starting and stopping.
    hooks: [
      { event: 'beforeSubmitPrompt', chimeEvent: 'working' },
      { event: 'stop', chimeEvent: 'done' },
    ],
    hookOptions: { timeout: 10 },
    layout: 'flat',
    required: { version: 1 },
  },
};

/** Every command Agent Chime writes runs hook.sh from a folder named .agent-chime. */
export function isChimeCommand(command: unknown): boolean {
  return typeof command === 'string' && /agent-chime/i.test(command) && /hook\.sh/.test(command);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function hookCommand(scriptPath: string, agent: AgentId, event: ChimeEvent): string {
  return `sh ${shellQuote(scriptPath)} ${agent} ${event}`;
}

interface HookEntry {
  type?: string;
  command?: unknown;
  [key: string]: unknown;
}

interface HookGroup {
  matcher?: string;
  /** Set when the group is itself a hook, as in Cursor's hooks.json. */
  command?: unknown;
  hooks?: HookEntry[];
  [key: string]: unknown;
}

type HooksObject = Record<string, HookGroup[]>;

export class ConfigError extends Error {}

function parseConfig(text: string, file: string): Record<string, unknown> {
  if (text.trim() === '') return {};
  const errors: ParseError[] = [];
  const value = parse(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const first = errors[0]!;
    throw new ConfigError(
      `${file} could not be read (${printParseErrorCode(first.error)} at character ${first.offset}). Fix it and try again.`,
    );
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfigError(`${file} should hold a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function readHooks(config: Record<string, unknown>, file: string): HooksObject {
  const hooks = config.hooks;
  if (hooks === undefined) return {};
  if (hooks === null || typeof hooks !== 'object' || Array.isArray(hooks)) {
    throw new ConfigError(`"hooks" in ${file} should be an object.`);
  }
  return hooks as HooksObject;
}

/** Matches the file's own indentation so an edit doesn't reformat the parts we don't touch. */
function formattingFor(text: string): FormattingOptions {
  const indent = /\n([ \t]+)\S/.exec(text)?.[1];
  if (indent?.startsWith('\t')) return { insertSpaces: false, tabSize: 1, eol: '\n' };
  return { insertSpaces: true, tabSize: indent ? indent.length : 2, eol: text.includes('\r\n') ? '\r\n' : '\n' };
}

/** The groups for one event with Agent Chime's entries taken out. */
function withoutChimeGroups(groups: HookGroup[]): HookGroup[] {
  const kept: HookGroup[] = [];
  for (const group of groups) {
    if (isChimeCommand(group.command)) continue;
    const entries = Array.isArray(group.hooks) ? group.hooks : [];
    const others = entries.filter((entry) => !isChimeCommand(entry.command));
    if (others.length === entries.length) {
      kept.push(group);
    } else if (others.length > 0) {
      kept.push({ ...group, hooks: others });
    }
  }
  return kept;
}

function setEvent(text: string, event: string, groups: HookGroup[] | undefined): string {
  const edits = modify(text, ['hooks', event], groups, { formattingOptions: formattingFor(text) });
  return applyEdits(text, edits);
}

/** The name Agent Chime's hooks go under in Antigravity CLI's hooks.json. */
export const HOOK_SET_NAME = 'agent-chime';

/** Removes every Agent Chime hook from a settings file's text. Other hooks are left as they were. */
export function removeChimeHooks(text: string, file = 'the settings file'): string {
  const config = parseConfig(text, file);
  let result = text.trim() === '' ? '{}' : text;
  if (config[HOOK_SET_NAME] !== undefined) {
    result = applyEdits(result, modify(result, [HOOK_SET_NAME], undefined, { formattingOptions: formattingFor(result) }));
  }
  const hooks = readHooks(config, file);
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = withoutChimeGroups(groups);
    if (kept.length === groups.length && kept.every((group, i) => group === groups[i])) continue;
    result = setEvent(result, event, kept.length > 0 ? kept : undefined);
  }
  const after = readHooks(parseConfig(result, file), file);
  if (Object.keys(hooks).length > 0 && Object.keys(after).length === 0) {
    // Everything under "hooks" was ours: drop the empty object too.
    result = applyEdits(result, modify(result, ['hooks'], undefined, { formattingOptions: formattingFor(result) }));
  }
  return result;
}

/** Adds Agent Chime's hooks for one agent, replacing any it added before. */
export function addChimeHooks(text: string, agent: AgentId, scriptPath: string, file = 'the settings file'): string {
  const info = AGENTS[agent];
  let result = removeChimeHooks(text, file);
  for (const [key, value] of Object.entries(info.required ?? {})) {
    if (parseConfig(result, file)[key] === undefined) {
      result = applyEdits(result, modify(result, [key], value, { formattingOptions: formattingFor(result) }));
    }
  }
  if (info.layout === 'named') {
    const set: Record<string, unknown> = { enabled: true };
    for (const spec of info.hooks) {
      set[spec.event] = [{ type: 'command', command: hookCommand(scriptPath, agent, spec.chimeEvent), ...info.hookOptions }];
    }
    result = applyEdits(result, modify(result, [HOOK_SET_NAME], set, { formattingOptions: formattingFor(result) }));
    return result.endsWith('\n') ? result : `${result}\n`;
  }
  for (const spec of info.hooks) {
    const existing = readHooks(parseConfig(result, file), file)[spec.event];
    const groups = Array.isArray(existing) ? [...existing] : [];
    const command = hookCommand(scriptPath, agent, spec.chimeEvent);
    if (info.layout === 'flat') {
      groups.push({ command, ...info.hookOptions, ...(spec.matcher ? { matcher: spec.matcher } : {}) });
    } else {
      const group: HookGroup = {};
      if (spec.matcher) group.matcher = spec.matcher;
      group.hooks = [{ type: 'command', command, ...info.hookOptions }];
      groups.push(group);
    }
    result = setEvent(result, spec.event, groups);
  }
  return result.endsWith('\n') ? result : `${result}\n`;
}

export function hasChimeHooks(text: string): boolean {
  try {
    const config = parseConfig(text, '');
    if (config[HOOK_SET_NAME] !== undefined) return true;
    const hooks = readHooks(config, '');
    return Object.values(hooks).some(
      (groups) =>
        Array.isArray(groups) &&
        groups.some(
          (group) =>
            isChimeCommand(group.command) ||
            (Array.isArray(group.hooks) && group.hooks.some((entry) => isChimeCommand(entry.command))),
        ),
    );
  } catch {
    return false;
  }
}

function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Saves a copy of the file the first time Agent Chime changes it. */
function backUpOnce(file: string, text: string): void {
  const backup = `${file}.agent-chime-backup`;
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, text);
}

function writeIfChanged(file: string, before: string | undefined, after: string): boolean {
  if (after === before) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (before !== undefined) backUpOnce(file, before);
  // Write to a temporary file first so an agent reading the settings never sees half a file.
  const temporary = `${file}.agent-chime-${process.pid}.tmp`;
  fs.writeFileSync(temporary, after);
  fs.renameSync(temporary, file);
  return true;
}

/** Whether the agent seems to be installed: its settings folder exists. */
export function isInstalled(agent: AgentId): boolean {
  return fs.existsSync(path.dirname(AGENTS[agent].configFile()));
}

export function isConnected(agent: AgentId): boolean {
  const text = readText(AGENTS[agent].configFile());
  return text !== undefined && hasChimeHooks(text);
}

/** Returns true if the settings file changed. */
export function connect(agent: AgentId, scriptPath: string): boolean {
  const file = AGENTS[agent].configFile();
  const before = readText(file);
  return writeIfChanged(file, before, addChimeHooks(before ?? '', agent, scriptPath, file));
}

/** Returns true if the settings file changed. */
export function disconnect(agent: AgentId): boolean {
  const file = AGENTS[agent].configFile();
  const before = readText(file);
  if (before === undefined) return false;
  return writeIfChanged(file, before, removeChimeHooks(before, file));
}
