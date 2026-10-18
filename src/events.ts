import { AGENTS, type AgentId, type ChimeEvent } from './agents';

/** One report from the hook script, read from its query string and the agent's hook JSON. */
export interface AgentNotice {
  agent: AgentId;
  state: ChimeEvent;
  /** The hook script's process id; the agent and the terminal's shell are its ancestors. */
  pid: number;
  sessionId?: string;
  /** A short line about what happened, such as the start of the agent's last message. */
  detail?: string;
}

const STATES: readonly ChimeEvent[] = ['working', 'done', 'failed', 'needs-input'];
const DETAIL_LENGTH = 140;

function isAgent(value: string | null): value is AgentId {
  return value !== null && Object.hasOwn(AGENTS, value);
}

function isState(value: string | null): value is ChimeEvent {
  return value !== null && (STATES as readonly string[]).includes(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** First line worth showing, shortened to fit a notification. Heading, quote and list marks at the start are dropped. */
export function summarize(message: string | undefined): string | undefined {
  if (!message) return undefined;
  const line = message
    .split(/\r?\n/)
    .map((part) => part.trim().replace(/^(?:[#>]+\s*|[-*+]\s+)+/, '').trim())
    .find((part) => part !== '');
  if (!line) return undefined;
  return line.length > DETAIL_LENGTH ? `${line.slice(0, DETAIL_LENGTH - 1).trimEnd()}…` : line;
}

function detailFor(state: ChimeEvent, payload: Record<string, unknown>): string | undefined {
  switch (state) {
    case 'done':
      return summarize(text(payload.last_assistant_message));
    case 'failed':
      return summarize(text(payload.error) ?? text(payload.message));
    case 'needs-input': {
      const toolInput = payload.tool_input as Record<string, unknown> | undefined;
      const fromTool =
        text(toolInput?.description) ?? text(toolInput?.command) ?? (text(payload.tool_name) && `Wants to use ${payload.tool_name}`);
      return summarize(text(payload.message) ?? fromTool);
    }
    case 'working':
      return undefined;
  }
}

export function readNotice(query: URLSearchParams, body: string): AgentNotice | undefined {
  const agent = query.get('agent');
  const state = query.get('event');
  const pid = Number(query.get('pid'));
  if (!isAgent(agent) || !isState(state) || !Number.isInteger(pid) || pid <= 1) return undefined;

  let payload: Record<string, unknown> = {};
  try {
    const parsed: unknown = body.trim() === '' ? {} : JSON.parse(body);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
  } catch {
    // A report without readable JSON still says which agent and what happened.
  }

  return { agent, state, pid, sessionId: text(payload.session_id), detail: detailFor(state, payload) };
}
