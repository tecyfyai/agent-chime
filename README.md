# Agent Chime

Hear when your coding agent is done. Agent Chime plays a sound when **Claude Code**, **Codex** or **Antigravity CLI** finishes in a terminal, or when **Cursor's own agent** finishes in Cursor, and a different sound when an agent stops to ask for your approval, so you can work on something else while it runs. It works in VS Code, Cursor, Windsurf and VSCodium.

- **Two sounds**: a soft chime when the agent finishes, a double knock when it is waiting for you.
- **Knows which terminal**: with several agents running, the notification names the terminal, and **Show Terminal** takes you there.
- **Says how long it took**: "Claude Code finished in "api" after 4m 12s". The status bar shows how long an agent has been working.
- **Only for long runs, if you like**: set a minimum, say 30 seconds, and quick answers you were watching anyway stay quiet.
- **Quiet when you're watching**: no sound if you are already looking at that agent's terminal.
- **Status bar**: shows how many agents are working, finished or waiting. Click it to jump to one, mute, switch on alerts while you watch, or open the settings.
- **One-click setup** and one-click removal.
- **Stays on your computer**: the agents talk to VS Code over `127.0.0.1` only.

## Getting started

1. Install Agent Chime. On first start it offers to connect the agents it finds: choose **Connect**. You can also run **Agent Chime: Connect Agents** from the Command Palette at any time, for example to add an agent you installed later.
2. **Codex only**: Codex asks you to review new hooks before it runs them. Start Codex, type `/hooks` and approve the Agent Chime ones.
3. Restart any agent sessions that were already running.
4. Run **Agent Chime: Play Test Sounds** to check your volume.

Then start `claude`, `codex` or `agy` in a terminal as usual, or ask Cursor's agent in its chat.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `agentChime.doneSound` | `chime` | Sound when an agent finishes: `chime`, `knock`, `none`, or the path to your own `.wav`, `.mp3` or `.aiff` file. |
| `agentChime.needsInputSound` | `knock` | Sound when an agent waits for your approval or an answer. |
| `agentChime.volume` | `70` | From 0 to 100. |
| `agentChime.whenFocused` | `otherTerminal` | While the editor is in front: `otherTerminal` stays quiet only for the terminal you are looking at, `always` plays anyway, `never` plays only when the editor is in the background. |
| `agentChime.showNotification` | `true` | Also show a notification with a **Show Terminal** button. |
| `agentChime.minWorkingSeconds` | `0` | Only alert when an agent finishes after working at least this many seconds. Errors and requests for approval always alert. |

**Agent Chime: Mute or Unmute** silences every window until you unmute.

By default Agent Chime stays quiet for the terminal you are looking at. To hear it anyway, run **Agent Chime: Alert While Watching: On or Off**, or pick it from the status bar menu. That sets `whenFocused` to `always`, and running it again sets it back.

## What it changes

**Connect** adds a few entries to the agents' own hook settings, each running one small script, `~/.agent-chime/hook.sh`:

| | Claude Code (`~/.claude/settings.json`) | Codex (`~/.codex/hooks.json`) | Antigravity CLI (`~/.gemini/config/hooks.json`) | Cursor (`~/.cursor/hooks.json`) |
| --- | --- | --- | --- | --- |
| Started working | `UserPromptSubmit` | `UserPromptSubmit` | `PreInvocation` (the first of each prompt) | `beforeSubmitPrompt` |
| Finished | `Stop`, and `StopFailure` for errors | `Stop` | `Stop` | `stop` |
| Waiting for you | `Notification` (permission prompts and questions) | `PermissionRequest` | none: no hook for this | none: no hook for this |

In Antigravity CLI's file, Agent Chime's hooks sit under their own name, `agent-chime`, next to any you have.

The script tells the open editor windows what happened. The window whose terminal the agent runs in plays the sound; the others ignore it. Cursor's own agent has no terminal, so for it the Cursor window with the same folders open plays the sound. The script only reports: it prints nothing back to Claude Code or Codex, and to Cursor and Antigravity CLI, which expect JSON, it answers with JSON that lets them carry on: `{}`, `{"continue":true}` for Cursor's prompt hook, and `{"decision":"stop"}` for Antigravity's Stop hook, which lets the agent stop as it meant to.

Your other settings and hooks stay as they are, and a copy of each file is saved the first time Agent Chime changes it (`settings.json.agent-chime-backup`, `hooks.json.agent-chime-backup`). **Agent Chime: Disconnect Agents** takes the entries out again. Uninstalling the extension doesn't, so disconnect first.

If `CLAUDE_CONFIG_DIR` or `CODEX_HOME` is set, Agent Chime uses those folders.

## Good to know

- **macOS and Linux.** On Windows, use VS Code with WSL. On Linux, one of `pw-play`, `paplay` or `aplay` plays the sound, and `curl` must be installed.
- **Local terminals.** An agent inside `tmux` or `screen`, or in a Remote SSH or container window, isn't matched to its terminal yet, so it stays silent.
- **Codex** needs a version with hooks (spring 2026 or later).
- **Antigravity CLI** (`agy`), which replaced Gemini CLI, and **Cursor's own agent** play the finish sound only: neither gives hooks a way to say it is waiting for your approval. If you stop Cursor's agent yourself, it stays quiet. Gemini CLI itself is not supported.

## Troubleshooting

- **No sound at all**: run **Agent Chime: Play Test Sounds**. If that is silent, check `agentChime.volume` and your system volume.
- **Test sounds play but agents are silent**: check that the agent was started after you connected, inside a terminal of the editor, and for Codex that you approved the hooks in `/hooks`. In Antigravity CLI, `/hooks` shows whether the `agent-chime` hooks are loaded.

## Help and privacy

- Questions or problems: [contact@hamperpick.in](mailto:contact@hamperpick.in)
- Website: [hamperpick.in/tools/agent-chime](https://hamperpick.in/tools/agent-chime)
- Privacy: [what Agent Chime keeps and where](https://hamperpick.in/tools/agent-chime/privacy)

## Related

[ReRead](https://marketplace.visualstudio.com/items?itemName=hamperpick.reread) (also on [Open VSX](https://open-vsx.org/extension/hamperpick/reread) and as [`npx reread-cli`](https://www.npmjs.com/package/reread-cli)) shows how much of your Claude Code, Codex and Antigravity usage went to re-reading context and thinking, and counts down until your prompt cache goes cold.

## Licence

MIT. The sounds were made for this extension and are covered by the same licence.
