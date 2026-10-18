import * as vscode from 'vscode';
import { AGENTS, type AgentId, type ChimeEvent } from './agents';

export interface AgentTerminal {
  terminal: vscode.Terminal;
  agent: AgentId;
  state: ChimeEvent;
  since: number;
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

/** The state of each terminal an agent has reported from, and the status bar item that sums it up. */
export class AgentTerminals implements vscode.Disposable {
  private readonly entries = new Map<vscode.Terminal, AgentTerminal>();
  private readonly item = vscode.window.createStatusBarItem('agentChime.status', vscode.StatusBarAlignment.Right, 100);
  private readonly subscriptions: vscode.Disposable[] = [];
  private muted = false;

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

  get(terminal: vscode.Terminal): AgentTerminal | undefined {
    return this.entries.get(terminal);
  }

  list(): AgentTerminal[] {
    return [...this.entries.values()].sort((a, b) => b.since - a.since);
  }

  update(terminal: vscode.Terminal, agent: AgentId, state: ChimeEvent, detail: string | undefined, unseen: boolean): AgentTerminal {
    const entry: AgentTerminal = { terminal, agent, state, since: Date.now(), unseen: unseen && state !== 'working', detail };
    this.entries.set(terminal, entry);
    this.render();
    return entry;
  }

  markSeen(terminal: vscode.Terminal): void {
    const entry = this.entries.get(terminal);
    if (entry?.unseen) {
      entry.unseen = false;
      this.render();
    }
  }

  private render(): void {
    const all = this.list();
    const waiting = all.filter((entry) => entry.unseen && entry.state === 'needs-input').length;
    const finished = all.filter((entry) => entry.unseen && (entry.state === 'done' || entry.state === 'failed')).length;
    const working = all.filter((entry) => entry.state === 'working').length;

    const parts: string[] = [];
    if (waiting > 0) parts.push(`$(bell-dot) ${waiting} waiting`);
    if (finished > 0) parts.push(`$(check) ${finished} done`);
    if (working > 0) parts.push(`$(sync~spin) ${working}`);
    const bell = this.muted ? '$(bell-slash)' : '$(bell)';
    this.item.text = parts.length > 0 ? `${this.muted ? '$(bell-slash) ' : ''}${parts.join('  ')}` : bell;
    this.item.backgroundColor = waiting > 0 ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;

    const tooltip = new vscode.MarkdownString('', true);
    tooltip.appendMarkdown(this.muted ? '**Agent Chime** (muted)\n\n' : '**Agent Chime**\n\n');
    if (all.length === 0) {
      tooltip.appendMarkdown('No agent has reported from a terminal in this window yet.');
    } else {
      for (const entry of all) {
        tooltip.appendMarkdown(`${ICONS[entry.state]} ${AGENTS[entry.agent].name} in "${entry.terminal.name}": ${describeState(entry)}\n\n`);
      }
    }
    this.item.tooltip = tooltip;
  }

  dispose(): void {
    this.item.dispose();
    for (const subscription of this.subscriptions) subscription.dispose();
  }
}

