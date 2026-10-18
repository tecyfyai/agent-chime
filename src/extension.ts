import * as vscode from 'vscode';
import { AGENTS, ConfigError, connect, disconnect, isConnected, isInstalled, type AgentId, type ChimeEvent } from './agents';
import type { AgentNotice } from './events';
import { installHookScript } from './hookScript';
import { Listener } from './listener';
import { ancestors, listProcesses } from './processTree';
import { playSound, soundFile } from './sounds';
import { AgentTerminals, describeState, ICONS } from './terminals';

const MUTED_KEY = 'agentChime.muted';
const ASKED_KEY = 'agentChime.askedToConnect';
/** The same report from the same terminal within this time makes no second sound. */
const REPEAT_WINDOW_MS = 2_000;

/** What a report from the hook script led to; the tests read these. */
export interface HandledNotice {
  notice: AgentNotice;
  terminal?: vscode.Terminal;
  alerted: boolean;
}

export interface AgentChimeApi {
  onDidHandleNotice: vscode.Event<HandledNotice>;
}

function withTimeout<T>(promise: Thenable<T>, ms: number): Promise<T | undefined> {
  return Promise.race([Promise.resolve(promise), new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))]);
}

/** The terminal in this window whose shell the reporting process runs under, if any. */
async function findTerminal(pid: number): Promise<vscode.Terminal | undefined> {
  const terminals = vscode.window.terminals;
  if (terminals.length === 0) return undefined;
  const chain = new Set(ancestors(pid, await listProcesses()));
  for (const terminal of terminals) {
    const shellPid = await withTimeout(terminal.processId, 1_000);
    if (shellPid !== undefined && chain.has(shellPid)) return terminal;
  }
  return undefined;
}

function settings() {
  const config = vscode.workspace.getConfiguration('agentChime');
  return {
    doneSound: config.get<string>('doneSound', 'chime'),
    needsInputSound: config.get<string>('needsInputSound', 'knock'),
    volume: config.get<number>('volume', 70),
    whenFocused: config.get<'otherTerminal' | 'always' | 'never'>('whenFocused', 'otherTerminal'),
    showNotification: config.get<boolean>('showNotification', true),
  };
}

function isLookingAt(terminal: vscode.Terminal): boolean {
  return vscode.window.state.focused && vscode.window.activeTerminal === terminal;
}

function shouldAlert(terminal: vscode.Terminal): boolean {
  switch (settings().whenFocused) {
    case 'always':
      return true;
    case 'never':
      return !vscode.window.state.focused;
    case 'otherTerminal':
      return !isLookingAt(terminal);
  }
}

function headline(agent: AgentId, state: ChimeEvent, terminal: vscode.Terminal): string {
  const name = AGENTS[agent].name;
  switch (state) {
    case 'needs-input':
      return `${name} is waiting for you in "${terminal.name}"`;
    case 'failed':
      return `${name} stopped with an error in "${terminal.name}"`;
    default:
      return `${name} finished in "${terminal.name}"`;
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<AgentChimeApi> {
  const mediaDir = vscode.Uri.joinPath(context.extensionUri, 'media').fsPath;
  const handled = new vscode.EventEmitter<HandledNotice>();
  const terminals = new AgentTerminals();
  terminals.setMuted(context.globalState.get<boolean>(MUTED_KEY, false));
  context.subscriptions.push(handled, terminals);

  async function play(setting: string): Promise<void> {
    const file = soundFile(setting, mediaDir);
    if (file) await playSound(file, settings().volume);
  }

  function notify(terminal: vscode.Terminal, agent: AgentId, state: ChimeEvent, detail: string | undefined): void {
    const message = detail ? `${headline(agent, state, terminal)}: ${detail}` : headline(agent, state, terminal);
    const show = state === 'needs-input' ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
    void show(message, 'Show Terminal').then((choice) => {
      if (choice) {
        terminal.show();
        terminals.markSeen(terminal);
      }
    });
  }

  async function onNotice(notice: AgentNotice): Promise<void> {
    if (process.platform === 'win32') return;
    const terminal = await findTerminal(notice.pid);
    if (!terminal) {
      handled.fire({ notice, alerted: false });
      return;
    }
    const previous = terminals.get(terminal);
    const repeat = previous?.state === notice.state && Date.now() - previous.since < REPEAT_WINDOW_MS;
    const alert = notice.state !== 'working' && !repeat && shouldAlert(terminal);
    terminals.update(terminal, notice.agent, notice.state, notice.detail, !isLookingAt(terminal));

    const muted = context.globalState.get<boolean>(MUTED_KEY, false);
    if (alert && !muted) {
      const { doneSound, needsInputSound, showNotification } = settings();
      if (showNotification) notify(terminal, notice.agent, notice.state, notice.detail);
      // Not awaited: the hook script, and with it Codex, would otherwise wait for the sound to end.
      play(notice.state === 'needs-input' ? needsInputSound : doneSound).catch((error: unknown) =>
        console.error('[agent-chime] could not play sound', error),
      );
    }
    handled.fire({ notice, terminal, alerted: alert && !muted });
  }

  async function connectAgents(): Promise<void> {
    if (process.platform === 'win32') {
      void vscode.window.showErrorMessage(
        'Agent Chime works on macOS and Linux for now. On Windows, open your folder in WSL and install it there.',
      );
      return;
    }
    const picks = await vscode.window.showQuickPick(
      (Object.keys(AGENTS) as AgentId[]).map((id) => ({
        id,
        label: AGENTS[id].name,
        description: isConnected(id) ? 'connected' : isInstalled(id) ? undefined : 'not found on this computer',
        picked: isInstalled(id) || isConnected(id),
      })),
      { canPickMany: true, title: 'Agent Chime: which agents should play a sound?' },
    );
    if (!picks || picks.length === 0) return;

    const script = installHookScript();
    const done: string[] = [];
    for (const pick of picks) {
      try {
        connect(pick.id, script);
        done.push(pick.label);
      } catch (error) {
        const reason = error instanceof ConfigError ? error.message : String(error);
        void vscode.window.showErrorMessage(`Agent Chime could not connect ${pick.label}: ${reason}`);
      }
    }
    if (done.length === 0) return;
    await context.globalState.update(ASKED_KEY, true);
    void vscode.window.showInformationMessage(
      `Agent Chime is connected to ${done.join(' and ')}. Sessions that are already running pick it up when restarted.`,
    );
    if (picks.some((pick) => pick.id === 'codex')) {
      void vscode.window.showInformationMessage(
        'Codex runs new hooks only once you trust them: start Codex, type /hooks and trust the Agent Chime hooks.',
      );
    }
  }

  async function disconnectAgents(): Promise<void> {
    const changed: string[] = [];
    for (const id of Object.keys(AGENTS) as AgentId[]) {
      try {
        if (disconnect(id)) changed.push(AGENTS[id].name);
      } catch (error) {
        void vscode.window.showErrorMessage(`Agent Chime could not change ${AGENTS[id].name}'s settings: ${String(error)}`);
      }
    }
    void vscode.window.showInformationMessage(
      changed.length > 0 ? `Agent Chime's hooks were removed from ${changed.join(' and ')}.` : 'Agent Chime was not connected to any agent.',
    );
  }

  async function setMuted(muted: boolean): Promise<void> {
    await context.globalState.update(MUTED_KEY, muted);
    terminals.setMuted(muted);
  }

  async function showAgents(): Promise<void> {
    type Item = vscode.QuickPickItem & { run?: () => unknown };
    const muted = context.globalState.get<boolean>(MUTED_KEY, false);
    const agentItems: Item[] = terminals.list().map((entry) => ({
      label: `${ICONS[entry.state]} ${entry.terminal.name}`,
      description: `${AGENTS[entry.agent].name}, ${describeState(entry)}`,
      detail: entry.detail,
      run: () => {
        entry.terminal.show();
        terminals.markSeen(entry.terminal);
      },
    }));
    const items: Item[] = [
      ...agentItems,
      { label: 'Agent Chime', kind: vscode.QuickPickItemKind.Separator },
      { label: muted ? '$(bell) Unmute' : '$(bell-slash) Mute', run: () => setMuted(!muted) },
      { label: '$(play) Play test sounds', run: testSounds },
      { label: '$(plug) Connect Claude Code and Codex', run: connectAgents },
      { label: '$(gear) Settings', run: () => vscode.commands.executeCommand('workbench.action.openSettings', 'agentChime') },
    ];
    const choice = await vscode.window.showQuickPick(items, {
      title: 'Agent terminals',
      placeHolder: agentItems.length > 0 ? 'Pick a terminal to open it' : 'No agent has reported from a terminal yet',
      matchOnDescription: true,
    });
    await choice?.run?.();
  }

  async function testSounds(): Promise<void> {
    const { doneSound, needsInputSound } = settings();
    try {
      await play(doneSound);
      await new Promise((resolve) => setTimeout(resolve, 400));
      await play(needsInputSound);
    } catch (error) {
      void vscode.window.showErrorMessage(`Agent Chime could not play a sound: ${String(error)}`);
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('agentChime.connect', connectAgents),
    vscode.commands.registerCommand('agentChime.disconnect', disconnectAgents),
    vscode.commands.registerCommand('agentChime.testSounds', testSounds),
    vscode.commands.registerCommand('agentChime.showAgents', showAgents),
    vscode.commands.registerCommand('agentChime.toggleMute', () =>
      setMuted(!context.globalState.get<boolean>(MUTED_KEY, false)),
    ),
  );

  if (process.platform !== 'win32') {
    // Keep the script on disk current, so an update to it reaches agents that are already connected.
    installHookScript();
    const listener = new Listener(onNotice);
    await listener.start();
    context.subscriptions.push(listener);
    void offerToConnect(context, connectAgents);
  }

  return { onDidHandleNotice: handled.event };
}

/** Asks once, on the first start, whether to connect the agents found on this computer. */
async function offerToConnect(context: vscode.ExtensionContext, connectAgents: () => Promise<void>): Promise<void> {
  if (context.globalState.get<boolean>(ASKED_KEY, false)) return;
  const ids = Object.keys(AGENTS) as AgentId[];
  if (ids.some(isConnected) || !ids.some(isInstalled)) return;
  const found = ids.filter(isInstalled).map((id) => AGENTS[id].name);
  const choice = await vscode.window.showInformationMessage(
    `Play a sound when ${found.join(' or ')} finishes or needs you? Agent Chime adds a few hooks to their settings; you can remove them any time.`,
    'Connect',
    'Not Now',
  );
  await context.globalState.update(ASKED_KEY, true);
  if (choice === 'Connect') await connectAgents();
}

export function deactivate(): void {}
