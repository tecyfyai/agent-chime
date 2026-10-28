import * as fs from 'node:fs';
import * as path from 'node:path';
import { hookScriptPath } from './paths';

/** Bumped whenever the script below changes, so an older copy on disk is replaced. */
const SCRIPT_VERSION = 2;

/**
 * The script the agents run from their hooks. It passes the hook's JSON on to every
 * open VS Code window, along with its own process id; the window whose terminal the agent runs
 * in plays the sound and the others ignore it. It always exits 0 and prints nothing that changes what
 * the agent does: nothing for Claude Code and Codex, and for Cursor and Antigravity CLI, which read a hook's
 * output as JSON, an answer that lets the agent carry on (for Antigravity's Stop hook, any decision but
 * "continue" lets it stop).
 */
export const HOOK_SCRIPT = `#!/bin/sh
# Agent Chime hook (version ${SCRIPT_VERSION}). Installed by the Agent Chime VS Code extension.
# Usage: hook.sh <agent> <event>, with the hook's JSON on stdin.
agent="$1"
event="$2"
case "$agent" in
  antigravity) if [ "$event" = done ]; then printf '{"decision":"stop"}'; else printf '{}'; fi ;;
  cursor) if [ "$event" = working ]; then printf '{"continue":true}'; else printf '{}'; fi ;;
esac
dir="\${AGENT_CHIME_HOME:-$HOME/.agent-chime}/windows"
[ -d "$dir" ] || exit 0
command -v curl >/dev/null 2>&1 || exit 0
if [ -t 0 ]; then payload=''; else payload=$(cat); fi
# Antigravity runs its start hook before every model call; only the first call of a prompt means it started.
if [ "$agent" = antigravity ] && [ "$event" = working ]; then
  case "$payload" in *'"invocationNum":0,'* | *'"invocationNum":0}'*) ;; *) exit 0 ;; esac
fi
for f in "$dir"/*.window; do
  [ -f "$f" ] || continue
  read -r port token < "$f" || continue
  printf '%s' "$payload" | curl -s -o /dev/null --connect-timeout 1 -m 3 \\
    -H "X-Agent-Chime-Token: $token" -H 'Content-Type: application/json' \\
    --data-binary @- "http://127.0.0.1:$port/event?agent=$agent&event=$event&pid=$$" 2>/dev/null
done
exit 0
`;

/** Writes the hook script if it is missing or out of date. */
export function installHookScript(): string {
  const file = hookScriptPath();
  let current: string | undefined;
  try {
    current = fs.readFileSync(file, 'utf8');
  } catch {
    current = undefined;
  }
  if (current !== HOOK_SCRIPT) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, HOOK_SCRIPT, { mode: 0o755 });
  }
  return file;
}
