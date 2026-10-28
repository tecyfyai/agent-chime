import * as vscode from 'vscode';
import { AGENTS, type AgentId, type ChimeEvent } from './agents';
import { formatDuration, runLength } from './timing';

/**
 * Where an agent runs: a terminal, or for Cursor's own agent, one of its chats (keyed by conversation id),
 * which has no terminal.
 */
export interface AgentPlace {
  key: vscode.Terminal | string;
  terminal?: vscode.Terminal;
  /** The terminal's name, or a name for the chat. */
  label: string;
}

export interface AgentTerminal extends AgentPlace {
  agent: AgentId;
  state: ChimeEvent;
  since: number;
  /** When the agent last started working, kept while it waits for you, so the finish can say how long it took. */
  startedAt?: number;
  /** Finished or waiting, and you haven't looked at the terminal since. */
  unseen: boolean;
  detail?: string;
}

export const ICONS: Record<ChimeEvent, string> = {
  working: '$(sync~spin)',
  done: '$(check)',
  failed: '$(error)',
  'needs-input': '$(bell-dot)',
};

/** How long ago, such as "5 min", or undefined when it was under a minute. */
function elapsed(since: number, now: number): string | undefined {
  const minutes = Math.floor((now - since) / 60_000);
  if (minutes < 1) return undefined;
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h`;
}

export function describeState(entry: Pick<AgentTerminal, 'state' | 'since'>, now = Date.now()): string {
  const time = elapsed(entry.since, now);
  switch (entry.state) {
    case 'working':
      return time ? `working for ${time}` : 'working';
    case 'done':
      return time ? `finished ${time} ago` : 'finished just now';
    case 'failed':
      return time ? `stopped with an error ${time} ago` : 'stopped with an error just now';
    case 'needs-input':
      return time ? `waiting for you for ${time}` : 'waiting for you';
  }
}

/** The state of each place an agent has reported from, and the status bar item that sums it up. */
export class AgentTerminals implements vscode.Disposable {
  private readonly entries = new Map<vscode.Terminal | string, AgentTerminal>();
  private readonly item = vscode.window.createStatusBarItem('agentChime.status', vscode.StatusBarAlignment.Right, 100);
  private readonly subscriptions: vscode.Disposable[] = [];
  private muted = false;
  /** Refreshes the time shown while an agent works. */
  private ticker: ReturnType<typeof setInterval> | undefined;

  constructor() {
    this.item.name = 'Agent Chime';
    this.item.command = 'agentChime.showAgents';
    this.subscriptions.push(
      vscode.window.onDidCloseTerminal((terminal) => {
        if (this.entries.delete(terminal)) this.render();
      }),
      vscode.window.onDidChangeActiveTerminal((terminal) => {
        if (terminal && vscode.window.state.focused) this.markSeen(terminal);
      }),
    );
    this.render();
    this.item.show();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.render();
  }

  get(key: vscode.Terminal | string): AgentTerminal | undefined {
    return this.entries.get(key);
  }

  list(): AgentTerminal[] {
    return [...this.entries.values()].sort((a, b) => b.since - a.since);
  }

  update(place: AgentPlace, agent: AgentId, state: ChimeEvent, detail: string | undefined, unseen: boolean): AgentTerminal {
    const now = Date.now();
    const previous = this.entries.get(place.key);
    // A second "working" report in the same run keeps the time it started.
    const running = runLength(previous, now) !== undefined;
    const startedAt = state === 'working' && !(running && previous?.state === 'working') ? now : running ? previous?.startedAt : undefined;
    const entry: AgentTerminal = { ...place, agent, state, since: now, startedAt, unseen: unseen && state !== 'working', detail };
    this.entries.set(place.key, entry);
    this.render();
    return entry;
  }

  markSeen(key: vscode.Terminal | string): void {
    const entry = this.entries.get(key);
    if (entry?.unseen) {
      entry.unseen = false;
      this.render();
    }
  }

  private render(): void {
    const all = this.list();
    const waiting = all.filter((entry) => entry.unseen && entry.state === 'needs-input').length;
    const finished = all.filter((entry) => entry.unseen && (entry.state === 'done' || entry.state === 'failed')).length;
    const working = all.filter((entry) => entry.state === 'working');

    const parts: string[] = [];
    if (waiting > 0) parts.push(`$(bell-dot) ${waiting} waiting`);
    if (finished > 0) parts.push(`$(check) ${finished} done`);
    if (working.length > 0) {
      // The longest-running agent's time, once it passes a minute.
      const longest = Date.now() - Math.min(...working.map((entry) => entry.since));
      const time = longest >= 60_000 ? ` ${formatDuration(Math.floor(longest / 60_000) * 60_000)}` : '';
      parts.push(`$(sync~spin) ${working.length}${time}`);
    }
    const bell = this.muted ? '$(bell-slash)' : '$(bell)';
    this.item.text = parts.length > 0 ? `${this.muted ? '$(bell-slash) ' : ''}${parts.join('  ')}` : bell;
    this.item.backgroundColor = waiting > 0 ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;

    const tooltip = new vscode.MarkdownString('', true);
    tooltip.appendMarkdown(this.muted ? '**Agent Chime** (muted)\n\n' : '**Agent Chime**\n\n');
    if (all.length === 0) {
      tooltip.appendMarkdown('No agent has reported from a terminal in this window yet.');
    } else {
      for (const entry of all) {
        const where = entry.terminal ? ` in "${entry.label}"` : '';
        tooltip.appendMarkdown(`${ICONS[entry.state]} ${AGENTS[entry.agent].name}${where}: ${describeState(entry)}\n\n`);
      }
    }
    this.item.tooltip = tooltip;

    if (working.length > 0 && !this.ticker) {
      this.ticker = setInterval(() => this.render(), 15_000);
    } else if (working.length === 0 && this.ticker) {
      clearInterval(this.ticker);
      this.ticker = undefined;
    }
  }

  dispose(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.item.dispose();
    for (const subscription of this.subscriptions) subscription.dispose();
  }
}
