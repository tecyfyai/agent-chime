import * as vscode from 'vscode';
import { AGENTS, ConfigError, connect, disconnect, isConnected, isInstalled, type AgentId, type ChimeEvent } from './agents';
import { sameFolders, type AgentNotice } from './events';
import { installHookScript } from './hookScript';
import { Listener } from './listener';
import { ancestors, listProcesses } from './processTree';
import { countAlert, ratingUrl } from './rating';
import { playSound, soundFile } from './sounds';
import { AgentTerminals, describeState, ICONS, type AgentPlace } from './terminals';
import { formatDuration, runLength } from './timing';

const MUTED_KEY = 'agentChime.muted';
const ASKED_KEY = 'agentChime.askedToConnect';
const ALERTS_KEY = 'agentChime.alertCount';
const RATING_KEY = 'agentChime.askedToRate';
/** The same report from the same terminal within this time makes no second sound. */
const REPEAT_WINDOW_MS = 2_000;

/** What a report from the hook script led to; the tests read these. */
export interface HandledNotice {
  notice: AgentNotice;
  terminal?: vscode.Terminal;
  alerted: boolean;
  /** How long the run took, when Agent Chime saw it start. */
  tookMs?: number;
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
    minWorkingSeconds: Math.max(0, config.get<number>('minWorkingSeconds', 0)),
  };
}

/** Whether this editor is Cursor, the only one whose own agent reports to Agent Chime. */
function isCursor(): boolean {
  return vscode.env.uriScheme === 'cursor' || /cursor/i.test(vscode.env.appName);
}

/** The place in this window the report came from: the agent's terminal, or a chat of Cursor's own agent. */
async function findPlace(notice: AgentNotice): Promise<AgentPlace | undefined> {
  const terminal = await findTerminal(notice.pid);
  if (terminal) return { key: terminal, terminal, label: terminal.name };
  if (notice.agent !== 'cursor' || !isCursor() || !notice.workspaceRoots) return undefined;
  const open = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
  if (!sameFolders(notice.workspaceRoots, open)) return undefined;
  return { key: `cursor:${notice.sessionId ?? 'chat'}`, label: 'Cursor chat' };
}

/** Looking at the agent's terminal, or for a chat, at this window. */
function isLookingAt(place: AgentPlace): boolean {
  if (!vscode.window.state.focused) return false;
  return place.terminal ? vscode.window.activeTerminal === place.terminal : true;
}

function shouldAlert(place: AgentPlace): boolean {
  switch (settings().whenFocused) {
    case 'always':
      return true;
    case 'never':
      return !vscode.window.state.focused;
    case 'otherTerminal':
      return !isLookingAt(place);
  }
}

export function headline(agent: AgentId, state: ChimeEvent, label: string | undefined, tookMs?: number): string {
  const name = AGENTS[agent].name;
  const where = label ? ` in "${label}"` : '';
  const took = tookMs !== undefined && tookMs >= 1000 ? ` after ${formatDuration(tookMs)}` : '';
  switch (state) {
    case 'needs-input':
      return `${name} is waiting for you${where}`;
    case 'failed':
      return `${name} stopped with an error${where}${took}`;
    default:
      return `${name} finished${where}${took}`;
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<AgentChimeApi> {
  const mediaDir = vscode.Uri.joinPath(context.extensionUri, 'media').fsPath;
  const handled = new vscode.EventEmitter<HandledNotice>();
  const terminals = new AgentTerminals();
  terminals.setMuted(context.globalState.get<boolean>(MUTED_KEY, false));
  // One line per report, for anyone wondering why an agent made no sound.
  const log = vscode.window.createOutputChannel('Agent Chime', { log: true });
  context.subscriptions.push(handled, terminals, log);

  async function play(setting: string): Promise<void> {
    const file = soundFile(setting, mediaDir);
    if (file) await playSound(file, settings().volume);
  }

  function notify(place: AgentPlace, notice: AgentNotice, tookMs: number | undefined): void {
    const title = headline(notice.agent, notice.state, place.terminal ? place.label : undefined, tookMs);
    const message = notice.detail ? `${title}: ${notice.detail}` : title;
    const show = notice.state === 'needs-input' ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
    const terminal = place.terminal;
    if (!terminal) {
      void show(message);
      return;
    }
    void show(message, 'Show Terminal').then((choice) => {
      if (choice) {
        terminal.show();
        terminals.markSeen(terminal);
      }
    });
  }

  async function onNotice(notice: AgentNotice): Promise<void> {
    if (process.platform === 'win32') return;
    const place = await findPlace(notice);
    const name = `${AGENTS[notice.agent].name} ${notice.state}`;
    if (!place) {
      log.info(`${name}: not from this window, ignored`);
      handled.fire({ notice, alerted: false });
      return;
    }
    const { doneSound, needsInputSound, showNotification, minWorkingSeconds } = settings();
    const previous = terminals.get(place.key);
    const tookMs = notice.state === 'working' ? undefined : runLength(previous, Date.now());
    const repeat = previous?.state === notice.state && Date.now() - previous.since < REPEAT_WINDOW_MS;
    // A quick finish is not worth a sound when you asked for long runs only; errors and questions always are.
    const quick = notice.state === 'done' && tookMs !== undefined && tookMs < minWorkingSeconds * 1000;
    const alert = notice.state !== 'working' && !repeat && !quick && !notice.stoppedByYou && shouldAlert(place);
    terminals.update(place, notice.agent, notice.state, notice.detail, !isLookingAt(place));

    const muted = context.globalState.get<boolean>(MUTED_KEY, false);
    const why = muted
      ? 'muted'
      : notice.state === 'working'
        ? 'started'
        : repeat
          ? 'repeat'
          : quick
            ? `shorter than ${minWorkingSeconds}s`
            : notice.stoppedByYou
              ? 'stopped by you'
              : alert
                ? 'alerted'
                : 'you were watching';
    const took = tookMs !== undefined ? ` after ${formatDuration(tookMs)}` : '';
    log.info(`${name} in "${place.label}"${took}: ${why}`);
    if (alert && !muted) {
      if (showNotification) notify(place, notice, tookMs);
      // Not awaited: the hook script, and with it Codex, would otherwise wait for the sound to end.
      play(notice.state === 'needs-input' ? needsInputSound : doneSound).catch((error: unknown) =>
        console.error('[agent-chime] could not play sound', error),
      );
      void askForRating(context, notice.state);
    }
    handled.fire({ notice, terminal: place.terminal, alerted: alert && !muted, tookMs });
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
      `Agent Chime is connected to ${listNames(done)}. Sessions that are already running pick it up when restarted.`,
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
      changed.length > 0 ? `Agent Chime's hooks were removed from ${listNames(changed)}.` : 'Agent Chime was not connected to any agent.',
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
      label: `${ICONS[entry.state]} ${entry.label}`,
      description: `${AGENTS[entry.agent].name}, ${describeState(entry)}`,
      detail: entry.detail,
      run: () => {
        entry.terminal?.show();
        terminals.markSeen(entry.key);
      },
    }));
    const watching = settings().whenFocused === 'always';
    const items: Item[] = [
      ...agentItems,
      { label: 'Agent Chime', kind: vscode.QuickPickItemKind.Separator },
      { label: muted ? '$(bell) Unmute' : '$(bell-slash) Mute', run: () => setMuted(!muted) },
      {
        label: watching ? '$(eye) Alert while I watch: on' : '$(eye-closed) Alert while I watch: off',
        description: 'also when the agent\'s terminal is in front',
        run: toggleWhileWatching,
      },
      { label: '$(play) Play test sounds', run: testSounds },
      { label: '$(plug) Connect agents', run: connectAgents },
      { label: '$(gear) Settings', run: () => vscode.commands.executeCommand('workbench.action.openSettings', 'agentChime') },
    ];
    const choice = await vscode.window.showQuickPick(items, {
      title: 'Agent terminals',
      placeHolder: agentItems.length > 0 ? 'Pick a terminal to open it' : 'No agent has reported from a terminal yet',
      matchOnDescription: true,
    });
    await choice?.run?.();
  }

  /** Switches between staying quiet for the terminal you look at (the default) and always alerting. */
  async function toggleWhileWatching(): Promise<void> {
    const on = settings().whenFocused !== 'always';
    await vscode.workspace
      .getConfiguration('agentChime')
      .update('whenFocused', on ? 'always' : 'otherTerminal', vscode.ConfigurationTarget.Global);
    void vscode.window.showInformationMessage(
      on
        ? 'Agent Chime now alerts even while you are looking at the agent.'
        : 'Agent Chime stays quiet while you are looking at the agent.',
    );
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
    vscode.commands.registerCommand('agentChime.toggleWhileWatching', toggleWhileWatching),
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

/** Counts the alerts, and after enough of them asks once for a rating. */
async function askForRating(context: vscode.ExtensionContext, state: ChimeEvent): Promise<void> {
  const { count, ask } = countAlert(
    context.globalState.get<number>(ALERTS_KEY, 0),
    context.globalState.get<boolean>(RATING_KEY, false),
    state,
  );
  await context.globalState.update(ALERTS_KEY, count);
  if (!ask) return;
  await context.globalState.update(RATING_KEY, true);
  const choice = await vscode.window.showInformationMessage(
    'Enjoying Agent Chime? A rating helps other developers find it.',
    'Rate',
    'No Thanks',
  );
  if (choice === 'Rate') await vscode.env.openExternal(vscode.Uri.parse(ratingUrl(vscode.env.uriScheme)));
}

/** Asks once, on the first start, whether to connect the agents found on this computer. */
async function offerToConnect(context: vscode.ExtensionContext, connectAgents: () => Promise<void>): Promise<void> {
  if (context.globalState.get<boolean>(ASKED_KEY, false)) return;
  const ids = Object.keys(AGENTS) as AgentId[];
  if (ids.some(isConnected) || !ids.some(isInstalled)) return;
  const found = ids.filter(isInstalled).map((id) => AGENTS[id].name);
  const choice = await vscode.window.showInformationMessage(
    `Play a sound when ${listNames(found, 'or')} finishes or needs you? Agent Chime adds a few hooks to their settings; you can remove them any time.`,
    'Connect',
    'Not Now',
  );
  await context.globalState.update(ASKED_KEY, true);
  if (choice === 'Connect') await connectAgents();
}

/** "A", "A and B", "A, B and C". */
function listNames(names: string[], word = 'and'): string {
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} ${word} ${names[names.length - 1]}`;
}

export function deactivate(): void {}
