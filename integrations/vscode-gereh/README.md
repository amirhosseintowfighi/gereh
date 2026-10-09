# Gereh Cloud for VS Code

Deploy and manage [Gereh](https://gereh.net) apps, databases and servers without leaving the editor.

- **Apps, Databases and Servers views** in the activity bar, refreshed every 30 seconds, with status, URLs, previews and domains.
- **Deploy** the linked folder (`gereh.json`) or any app; **deploy a preview** of a branch and **promote** it to production.
- **Live logs**, **restart**, and **run once** (migrations, scripts) in a new container from the live version.
- **Connect AI agents**: one command wires Copilot (agent mode), Claude Code, Cursor or Codex to Gereh's MCP server.
- Status bar shows the state of the app linked to the open folder; click to deploy.

## Getting started

1. In the Gereh panel › **SSH و API**, create a **read-write** token.
2. Run **Gereh: Sign in** and paste it. The token is kept in VS Code's secret storage.
3. Run **Gereh: Link this folder to an app** (writes `gereh.json`), then **Gereh: Deploy**.

Deploy, logs and one-off commands run the [Gereh CLI](https://www.npmjs.com/package/@gereh/cli) in a terminal (`npx -y @gereh/cli@latest`; change it with `gereh.cliCommand`). Node.js 20+ is needed for those.

## Settings

| Setting | Default | |
|---|---|---|
| `gereh.apiUrl` | `https://gereh.net` | Gereh site address |
| `gereh.cliCommand` | `npx -y @gereh/cli@latest` | how the CLI is run |
| `gereh.refreshSeconds` | `30` | view refresh interval |

## Publishing

```bash
npm i -g @vscode/vsce ovsx
vsce package                 # gereh-1.0.0.vsix (install with: code --install-extension gereh-1.0.0.vsix)
vsce publish                 # VS Code Marketplace (publisher "gereh")
ovsx publish gereh-1.0.0.vsix   # Open VSX (Cursor, VSCodium)
```
