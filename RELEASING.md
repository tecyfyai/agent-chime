# Releasing

Agent Chime is published to the VS Code Marketplace and to Open VSX (for Cursor, Windsurf and VSCodium).

## Git account

The repository lives at https://github.com/tecyfyai/agent-chime. Commits and pushes use the `tecyfyai` GitHub account only, over HTTPS. No other account is used, and the repository is never pushed over SSH. The clone is set up like this:

```bash
git remote set-url origin https://github.com/tecyfyai/agent-chime.git
git config --local user.name tecyfyai
git config --local user.email 344147863+tecyfyai@users.noreply.github.com
git config --local credential.https://github.com.helper ''
git config --local --add credential.https://github.com.helper '!f() { echo username=tecyfyai; echo password=$(gh auth token --user tecyfyai); }; f'
```

Before each push, check that `git config user.name` prints `tecyfyai` and that `git ls-remote origin HEAD` succeeds.

## Once

1. Marketplace: sign in at https://marketplace.visualstudio.com/manage with a Microsoft account and create the publisher `hamperpick`. Then create a personal access token in Azure DevOps (https://dev.azure.com, User settings, Personal access tokens) with **Organization: All accessible organizations** and the scope **Marketplace: Manage**.
2. Open VSX: sign in at https://open-vsx.org with GitHub, sign the publisher agreement, create an access token, and create the namespace: `npx ovsx create-namespace hamperpick -p "$OVSX_PAT"`.

## Each release

1. Update `version` in `package.json` and add a section to `CHANGELOG.md`.
2. Check everything passes: `npm run typecheck && npm test && npm run test:vscode`.
3. Package: `npm run package` (makes `agent-chime-<version>.vsix`).
4. Publish the same file to both stores:

```bash
npx vsce publish --packagePath agent-chime-0.1.0.vsix -p "$VSCE_PAT"
npx ovsx publish agent-chime-0.1.0.vsix -p "$OVSX_PAT"
```

## Development

- `npm run watch` rebuilds on change; press F5 in VS Code to start a window with the extension loaded.
- `npm run sounds` remakes `media/chime.wav` and `media/knock.wav` from `scripts/make-sounds.mjs`.
- The VS Code tests use a temporary `AGENT_CHIME_HOME`, so they never touch `~/.agent-chime`. `VSCODE_VERSION=1.90.0 npx vscode-test` runs them on the oldest supported VS Code.
- `brand/icon.svg` is the source of `media/icon.png` (256 px).
