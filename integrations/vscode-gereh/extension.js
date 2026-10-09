// Gereh Cloud for VS Code. No dependencies: the views read the public REST API (/api/v1) with the
// token kept in VS Code's secret storage; deploy, logs and one-off commands run the Gereh CLI in a
// terminal so their output streams exactly as in a shell.
"use strict";
const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");

const TOKEN_KEY = "gereh.token";
const TOKEN_RE = /^grh_[A-Za-z0-9]{40}$/;
let secrets;

const origin = () => String(vscode.workspace.getConfiguration("gereh").get("apiUrl") || "https://gereh.net").replace(/\/$/, "");

async function api(method, p, body) {
  const token = await secrets.get(TOKEN_KEY);
  if (!token) throw new Error("Sign in to Gereh first (Gereh: Sign in).");
  const res = await fetch(origin() + "/api/v1/" + p, {
    method, headers: { authorization: "Bearer " + token, "user-agent": "gereh-vscode/1.0", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j.error && j.error.message) || res.statusText || "HTTP " + res.status);
  return j;
}

/** the app linked to the open folder (gereh.json written by `gereh link`) */
function linkedApp() {
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (!folder) return null;
  try { return JSON.parse(fs.readFileSync(path.join(folder.uri.fsPath, "gereh.json"), "utf8")).app || null; } catch { return null; }
}

/** runs the CLI in a (reused) terminal with the token in its environment */
async function cli(args, name) {
  const token = await secrets.get(TOKEN_KEY);
  if (!token) return vscode.commands.executeCommand("gereh.signIn");
  const title = "Gereh: " + (name || args[0]);
  let term = vscode.window.terminals.find((t) => t.name === title);
  if (term) term.dispose();
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  term = vscode.window.createTerminal({ name: title, cwd: folder ? folder.uri.fsPath : undefined, env: { GEREH_TOKEN: token, GEREH_API: origin() } });
  term.show();
  const quote = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : "'" + s.replace(/'/g, "'\\''") + "'");
  term.sendText(String(vscode.workspace.getConfiguration("gereh").get("cliCommand") || "npx -y @gereh/cli@latest") + " " + args.map(quote).join(" "));
}

const STATUS_ICON = { running: ["pass-filled", "testing.iconPassed"], failed: ["error", "testing.iconFailed"], stopped: ["circle-slash", "disabledForeground"], suspended: ["warning", "problemsWarningIcon.foreground"], building: ["sync~spin", "charts.blue"], creating: ["sync~spin", "charts.blue"] };
const icon = (status) => { const [id, color] = STATUS_ICON[status] || ["circle-outline", undefined]; return new vscode.ThemeIcon(id, color ? new vscode.ThemeColor(color) : undefined); };

class Provider {
  constructor(kind) { this.kind = kind; this.items = null; this.error = null; this._ev = new vscode.EventEmitter(); this.onDidChangeTreeData = this._ev.event; }
  async load() {
    try {
      this.items = (await api("GET", this.kind)).data; this.error = null;
    } catch (e) { this.items = []; this.error = e.message; }
    this._ev.fire();
  }
  getTreeItem(x) { return x; }
  getChildren(el) {
    if (el) return el.kids || [];
    if (this.error) return [Object.assign(new vscode.TreeItem(this.error), { iconPath: new vscode.ThemeIcon("warning") })];
    if (!this.items) { void this.load(); return []; }
    const linked = linkedApp();
    return this.items.map((x) => {
      if (this.kind === "apps") {
        const t = new vscode.TreeItem(x.name, vscode.TreeItemCollapsibleState.Collapsed);
        t.description = x.status + (x.name === linked ? " · this folder" : "");
        t.tooltip = new vscode.MarkdownString("**" + x.name + "** — " + x.status + "\n\n" + x.url + "\n\n" + x.instances + " instance(s), plan `" + x.plan + "`" + (x.hourly_price_toman ? ", " + x.hourly_price_toman.toLocaleString() + " Toman/hour" : ""));
        t.iconPath = icon(x.status);
        t.contextValue = x.preview_deployment ? "app-preview" : "app";
        t.app = x;
        const kid = (label, desc, ic, cmd) => Object.assign(new vscode.TreeItem(label), { description: desc, iconPath: new vscode.ThemeIcon(ic), command: cmd });
        t.kids = [
          kid(x.url.replace("https://", ""), "open", "globe", { command: "vscode.open", title: "Open", arguments: [vscode.Uri.parse(x.url)] }),
          ...(x.preview_url ? [kid(x.preview_url.replace("https://", ""), "preview", "eye", { command: "vscode.open", title: "Open", arguments: [vscode.Uri.parse(x.preview_url)] })] : []),
          ...(x.latest_deployment ? [kid("Latest deployment", x.latest_deployment.status + " · " + x.latest_deployment.trigger, "rocket")] : []),
          ...x.domains.map((d) => kid(d.host, d.status, "link")),
        ];
        return t;
      }
      const t = new vscode.TreeItem(x.name);
      if (this.kind === "databases") { t.description = x.engine + " " + x.version + " · " + x.status; t.contextValue = "db"; t.tooltip = x.host ? x.host + ":" + x.port + " / " + x.database : x.status; }
      else { t.description = (x.ipv4 || "") + " · " + x.status; t.contextValue = "server"; t.tooltip = x.cpu + " vCPU, " + x.ram_gb + " GB RAM, " + x.disk_gb + " GB · " + x.location; }
      t.iconPath = icon(x.status === "active" ? "running" : x.status);
      t.item = x;
      return t;
    });
  }
}

/** an app from the clicked tree item, the linked folder, or a quick pick */
async function pickApp(item, providers) {
  if (item && item.app) return item.app.name;
  const linked = linkedApp();
  if (linked) return linked;
  if (!providers.apps.items) await providers.apps.load();
  const pick = await vscode.window.showQuickPick((providers.apps.items || []).map((a) => ({ label: a.name, description: a.status + " · " + a.url })), { placeHolder: "Which app?" });
  return pick && pick.label;
}

async function activate(context) {
  secrets = context.secrets;
  const providers = { apps: new Provider("apps"), databases: new Provider("databases"), servers: new Provider("servers") };
  for (const [k, p] of Object.entries(providers)) context.subscriptions.push(vscode.window.registerTreeDataProvider("gereh." + k, p));
  const refresh = () => Promise.all(Object.values(providers).map((p) => p.load()));
  const setSigned = async () => vscode.commands.executeCommand("setContext", "gereh.signedIn", !!(await secrets.get(TOKEN_KEY)));
  await setSigned();

  // status bar: the linked app
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  bar.command = "gereh.deploy";
  context.subscriptions.push(bar);
  const updateBar = () => {
    const name = linkedApp();
    const app = name && (providers.apps.items || []).find((a) => a.name === name);
    if (!app) return bar.hide();
    bar.text = "$(rocket) " + app.name + ": " + app.status;
    bar.tooltip = "Gereh — click to deploy " + app.name;
    bar.show();
  };
  providers.apps.onDidChangeTreeData(updateBar);

  const timer = setInterval(() => { void (async () => { if (await secrets.get(TOKEN_KEY)) await refresh(); })(); }, Math.max(10, Number(vscode.workspace.getConfiguration("gereh").get("refreshSeconds")) || 30) * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  const cmd = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, async (...a) => { try { await fn(...a); } catch (e) { vscode.window.showErrorMessage("Gereh: " + e.message); } }));

  cmd("gereh.signIn", async () => {
    const token = await vscode.window.showInputBox({ title: "Gereh API token", prompt: "Create a read-write token in Panel › SSH و API (" + origin() + "/panel/keys)", password: true, ignoreFocusOut: true, validateInput: (v) => (TOKEN_RE.test(v.trim()) ? null : "A Gereh token looks like grh_ followed by 40 letters and digits") });
    if (!token) return;
    await secrets.store(TOKEN_KEY, token.trim());
    try { const me = await api("GET", "account"); vscode.window.showInformationMessage("Signed in to Gereh as " + me.name + " (balance " + Number(me.balance_toman).toLocaleString() + " Toman)"); }
    catch (e) { await secrets.delete(TOKEN_KEY); throw e; }
    await setSigned(); await refresh();
  });
  cmd("gereh.signOut", async () => { await secrets.delete(TOKEN_KEY); await setSigned(); for (const p of Object.values(providers)) { p.items = null; p._ev.fire(); } bar.hide(); });
  cmd("gereh.refresh", refresh);
  cmd("gereh.deploy", async (item) => { const a = await pickApp(item, providers); if (a) await cli(["deploy", "--app", a], "deploy " + a); });
  cmd("gereh.deployPreview", async (item) => {
    const a = await pickApp(item, providers); if (!a) return;
    const app = (providers.apps.items || []).find((x) => x.name === a);
    const branch = app && app.source === "git" ? await vscode.window.showInputBox({ prompt: "Branch to preview (empty: the app's branch)" }) : "";
    if (branch === undefined) return;
    await cli(["deploy", "--app", a, "--preview", ...(branch ? ["--branch", branch] : [])], "preview " + a);
  });
  cmd("gereh.promote", async (item) => {
    const a = await pickApp(item, providers); if (!a) return;
    const ok = await vscode.window.showWarningMessage("Release the preview of " + a + " to production? (no rebuild; the release command runs first)", { modal: true }, "Promote");
    if (ok) await cli(["promote", "--app", a], "promote " + a);
  });
  cmd("gereh.logs", async (item) => { const a = await pickApp(item, providers); if (a) await cli(["logs", "-f", "--app", a], "logs " + a); });
  cmd("gereh.run", async (item) => {
    const a = await pickApp(item, providers); if (!a) return;
    const c = await vscode.window.showInputBox({ title: "Run once in " + a, prompt: "Runs in a new container from the live version, e.g. python manage.py migrate", ignoreFocusOut: true });
    if (c) await cli(["run", "--app", a, ...c.split(/\s+/)], "run " + a);
  });
  cmd("gereh.restart", async (item) => {
    const a = await pickApp(item, providers); if (!a) return;
    await api("POST", "apps/" + encodeURIComponent(a) + "/actions", { action: "restart" });
    vscode.window.showInformationMessage("Restarting " + a); await providers.apps.load();
  });
  cmd("gereh.open", async (item) => { const a = await pickApp(item, providers); const app = (providers.apps.items || []).find((x) => x.name === a); if (app) await vscode.env.openExternal(vscode.Uri.parse(app.url)); });
  cmd("gereh.openPanel", async (item) => {
    const p = item && item.app ? "/panel/apps/" + item.app.id : item && item.contextValue === "db" ? "/panel/databases/" + item.item.id : item && item.contextValue === "server" ? "/panel/servers/" + item.item.id : "/panel";
    await vscode.env.openExternal(vscode.Uri.parse(origin() + p));
  });
  cmd("gereh.link", async () => {
    if (!providers.apps.items) await providers.apps.load();
    const pick = await vscode.window.showQuickPick((providers.apps.items || []).map((a) => a.name), { placeHolder: "Link this folder to…" });
    if (pick) await cli(["link", pick], "link");
  });
  cmd("gereh.setupAgent", async () => {
    const choice = await vscode.window.showQuickPick([{ label: "VS Code (Copilot agent mode)", id: "vscode" }, { label: "Claude Code", id: "claude" }, { label: "Cursor", id: "cursor" }, { label: "Codex", id: "codex" }, { label: "All installed agents", id: "" }], { placeHolder: "Connect which AI agent to Gereh (MCP)?" });
    if (choice) await cli(["setup", "agent", ...(choice.id ? [choice.id] : [])], "setup agent");
  });

  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration("gereh.apiUrl")) void refresh(); }));
  if (await secrets.get(TOKEN_KEY)) void refresh();
}

function deactivate() {}

module.exports = { activate, deactivate };
