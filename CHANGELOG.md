# Changelog

## 0.2.0

Agent Chime now supports two more agents, reports how long each run took, and is available on Open VSX for Cursor, Windsurf and VSCodium.

### New agents

- **Cursor Agent.** In Cursor, Agent Chime plays the finish sound when Cursor's built-in agent completes a run in the chat. Runs that end in an error play the alert as an error, and runs you stop yourself stay silent. Cursor does not expose an approval event to hooks, so there is no "waiting for you" sound for this agent.
- **Antigravity CLI.** Agent Chime supports `agy`, Google's successor to Gemini CLI, in any terminal of the editor. Its hooks are added under their own `agent-chime` entry in `~/.gemini/config/hooks.json`. As with Cursor, Antigravity has no approval event, so only the finish sound plays.

To add either agent, run **Agent Chime: Connect Agents** from the Command Palette.

### New features

- **Run duration.** Notifications state how long the agent worked, for example "Claude Code finished in "api" after 4m 12s". While an agent is working, the status bar shows the elapsed time.
- **Minimum run time.** The new `agentChime.minWorkingSeconds` setting silences runs that finish sooner than the time you set. Errors and approval requests always alert. The default, `0`, keeps the current behaviour.
- **Alert while watching.** A new command, **Agent Chime: Alert While Watching: On or Off**, also available from the status bar menu, lets the sound play while the agent's terminal is in front. It is off by default.
- **Activity log.** The **Agent Chime** channel in the Output panel records each report and whether it played a sound, to help explain a missing alert.

### Changes

- The commands **Connect Claude Code and Codex** and **Disconnect Claude Code and Codex** are renamed **Connect Agents** and **Disconnect Agents**.
- The rating request opens the store your editor installs from: the Visual Studio Marketplace in VS Code, and Open VSX in Cursor, Windsurf and VSCodium.
- The listing is renamed **Agent Chime: Sound Alerts for Claude Code, Codex, Cursor & Antigravity**.
- The source code is now public at [github.com/tecyfyai/agent-chime](https://github.com/tecyfyai/agent-chime), and the listing links to it.

### Upgrading

Existing connections to Claude Code and Codex keep working without changes. The hook script in `~/.agent-chime` is updated automatically the first time the new version starts.

## 0.1.4

- After 20 sounds, asks once whether you would rate Agent Chime on the Marketplace. It never asks again.

## 0.1.3

- Clearer listing name, description and tags. No change to how the extension works.

## 0.1.2

- Listing: help, website and privacy links. No change to how the extension works.

## 0.1.1

- Marketplace listing details only; no change to how the extension works.

## 0.1.0

- First release: sounds when Claude Code or Codex finishes or needs your approval, matched to the VS Code terminal the agent runs in.
- Status bar summary, notifications with Show Terminal, mute, and one-click connect and disconnect.
