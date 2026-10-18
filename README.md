# Agent Chime

Hear when your coding agent is done. Agent Chime plays a sound when **Claude Code** or **Codex** finishes in a VS Code terminal, and a different sound when it stops to ask for your approval, so you can work on something else while it runs.

- **Two sounds**: a soft chime when the agent finishes, a double knock when it is waiting for you.
- **Knows which terminal**: with several agents running, the notification names the terminal, and **Show Terminal** takes you there.
- **Quiet when you're watching**: no sound if you are already looking at that agent's terminal.
- **Status bar**: shows how many agents are working, finished or waiting. Click it to jump to one, mute, or open the settings.
- **One-click setup** and one-click removal.
- **Stays on your computer**: the agents talk to VS Code over `127.0.0.1` only.

## Getting started

1. Install Agent Chime. On first start it offers to connect the agents it finds: choose **Connect**. You can also run **Agent Chime: Connect Claude Code and Codex** from the Command Palette at any time.
2. **Codex only**: Codex asks you to review new hooks before it runs them. Start Codex, type `/hooks` and approve the Agent Chime ones.
3. Restart any agent sessions that were already running.
4. Run **Agent Chime: Play Test Sounds** to check your volume.

Then start `claude` or `codex` in a VS Code terminal as usual.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `agentChime.doneSound` | `chime` | Sound when an agent finishes: `chime`, `knock`, `none`, or the path to your own `.wav`, `.mp3` or `.aiff` file. |
| `agentChime.needsInputSound` | `knock` | Sound when an agent waits for your approval or an answer. |
| `agentChime.volume` | `70` | From 0 to 100. |
| `agentChime.whenFocused` | `otherTerminal` | While VS Code is in front: `otherTerminal` stays quiet only for the terminal you are looking at, `always` plays anyway, `never` plays only when VS Code is in the background. |
| `agentChime.showNotification` | `true` | Also show a notification with a **Show Terminal** button. |

**Agent Chime: Mute or Unmute** silences every window until you unmute.

## What it changes

**Connect** adds a few entries to the agents' own hook settings, each running one small script, `~/.agent-chime/hook.sh`:

| | Claude Code (`~/.claude/settings.json`) | Codex (`~/.codex/hooks.json`) |
| --- | --- | --- |
| Started working | `UserPromptSubmit` | `UserPromptSubmit` |
| Finished | `Stop`, and `StopFailure` for errors | `Stop` |
| Waiting for you | `Notification` (permission prompts and questions) | `PermissionRequest` |

The script tells the open VS Code windows what happened. The window whose terminal the agent runs in plays the sound; the others ignore it. The script only reports: it prints nothing back to the agent.

Your other settings and hooks stay as they are, and a copy of each file is saved the first time Agent Chime changes it (`settings.json.agent-chime-backup`, `hooks.json.agent-chime-backup`). **Agent Chime: Disconnect Claude Code and Codex** takes the entries out again. Uninstalling the extension doesn't, so disconnect first.

If `CLAUDE_CONFIG_DIR` or `CODEX_HOME` is set, Agent Chime uses those folders.

## Good to know

- **macOS and Linux.** On Windows, use VS Code with WSL. On Linux, one of `pw-play`, `paplay` or `aplay` plays the sound, and `curl` must be installed.
- **Local terminals.** An agent inside `tmux` or `screen`, or in a Remote SSH or container window, isn't matched to its terminal yet, so it stays silent.
- **Codex** needs a version with hooks (spring 2026 or later).
- **Cursor, Windsurf and VSCodium** can install it from Open VSX.

## Troubleshooting

- **No sound at all**: run **Agent Chime: Play Test Sounds**. If that is silent, check `agentChime.volume` and your system volume.
- **Test sounds play but agents are silent**: check that the agent was started after you connected, inside a VS Code terminal, and for Codex that you approved the hooks in `/hooks`.

## Licence

MIT. The sounds were made for this extension and are covered by the same licence.
