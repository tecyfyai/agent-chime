import { defineConfig } from '@vscode/test-cli';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Keep the tests' hook script and window files out of the real ~/.agent-chime.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chime-vscode-'));
const workspace = path.join(home, 'workspace');
fs.mkdirSync(path.join(workspace, '.vscode'), { recursive: true });
fs.writeFileSync(
  path.join(workspace, '.vscode', 'settings.json'),
  JSON.stringify({ 'agentChime.doneSound': 'none', 'agentChime.needsInputSound': 'none', 'agentChime.showNotification': false }),
);

export default defineConfig({
  files: 'out/test/**/*.test.js',
  version: process.env.VSCODE_VERSION || 'stable',
  workspaceFolder: workspace,
  env: { AGENT_CHIME_HOME: home },
  mocha: { timeout: 120_000 },
});
