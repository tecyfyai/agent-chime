import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Where Agent Chime keeps its hook script and the list of open VS Code windows.
 * AGENT_CHIME_HOME moves it, which the tests use to stay out of the real home folder.
 */
export function chimeHome(): string {
  return process.env.AGENT_CHIME_HOME || path.join(os.homedir(), '.agent-chime');
}

export function hookScriptPath(): string {
  return path.join(chimeHome(), 'hook.sh');
}

/** One small file per open VS Code window, holding the port and token it listens on. */
export function windowsDir(): string {
  return path.join(chimeHome(), 'windows');
}

export function claudeSettingsPath(): string {
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(dir, 'settings.json');
}

export function codexHooksPath(): string {
  const dir = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  return path.join(dir, 'hooks.json');
}

/** Antigravity CLI, which replaced Gemini CLI, reads personal hooks from here. */
export function antigravityHooksPath(): string {
  return path.join(os.homedir(), '.gemini', 'config', 'hooks.json');
}

export function cursorHooksPath(): string {
  return path.join(os.homedir(), '.cursor', 'hooks.json');
}
