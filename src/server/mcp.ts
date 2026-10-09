/* MCP server (Model Context Protocol, Streamable HTTP transport) at /api/mcp, so coding agents
   (Claude Code, Cursor, Codex, VS Code Copilot…) can manage Gereh resources. Every tool is a thin
   wrapper over a public API route (src/server/publicApi.ts): same bearer tokens, the same ownership
   checks and the same read-only/read-write scopes. Responses are plain JSON (no SSE stream needed:
   no tool sends progress notifications). */
import "server-only";
import { ZodError } from "zod";
import type { Ctx } from "./ctx";
import { ROUTES, tokenAuth } from "./publicApi";
import { AppError } from "./util";

export const MCP_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "gereh", title: "Gereh Cloud", version: "1.0.0" };

type Json = Record<string, unknown>;
type Schema = { type: "object"; properties: Record<string, Json>; required?: string[] };
export type McpTool = {
  name: string; title: string; description: string; inputSchema: Schema; write?: boolean;
  /** HTTP method + path of the public API route, and the body sent to it */
  call: (a: Json) => [method: string, path: string, body?: Json];
};

const str = (description: string, extra: Json = {}) => ({ type: "string", description, ...extra });
const appArg = { app: str("App name (as in gereh.json) or id (app-…)") };
const seg = (v: unknown) => encodeURIComponent(String(v ?? ""));

export const MCP_TOOLS: McpTool[] = [
  { name: "get_account", title: "Account", description: "The signed-in Gereh account: name, email and wallet balance in Toman.", inputSchema: { type: "object", properties: {} }, call: () => ["GET", "account"] },
  { name: "list_apps", title: "List apps", description: "All Gereh Apps (PaaS) of the account with status, URL, size and latest deployment.", inputSchema: { type: "object", properties: {} }, call: () => ["GET", "apps"] },
  { name: "get_app", title: "Get app", description: "One app: status, URL, domains, plan, instances, hourly price and latest deployment.", inputSchema: { type: "object", properties: appArg, required: ["app"] }, call: (a) => ["GET", "apps/" + seg(a.app)] },
  { name: "deploy_app", title: "Deploy app", write: true, description: "Starts a new deployment: Git apps rebuild the configured branch, image apps pull the image again. Returns the deployment id; poll get_deployment until status is live or failed. (ZIP apps need an upload: use the CLI `gereh deploy`.)",
    inputSchema: { type: "object", properties: { ...appArg, message: str("Short note shown in the deployment list"), preview: { type: "boolean", description: "Build into the app's preview (<name>-preview host) instead of production" }, branch: str("Git branch for a preview (default: the app's branch)") }, required: ["app"] },
    call: (a) => ["POST", "apps/" + seg(a.app) + "/deployments", { message: a.message, via: "api", preview: a.preview, branch: a.branch }] },
  { name: "promote_deployment", title: "Promote preview", write: true, description: "Releases a successful preview deployment's image to production without rebuilding (the release command runs first).",
    inputSchema: { type: "object", properties: { ...appArg, deployment_id: str("Preview deployment id (dep-…)") }, required: ["app", "deployment_id"] }, call: (a) => ["POST", "apps/" + seg(a.app) + "/deployments/" + seg(a.deployment_id) + "/promote", {}] },
  { name: "get_deployment", title: "Get deployment", description: "Status (queued, building, deploying, live, failed…) and the full build log of a deployment.",
    inputSchema: { type: "object", properties: { ...appArg, deployment_id: str("Deployment id (dep-…)") }, required: ["app", "deployment_id"] }, call: (a) => ["GET", "apps/" + seg(a.app) + "/deployments/" + seg(a.deployment_id)] },
  { name: "app_logs", title: "App logs", description: "The last 300 runtime log lines of the app's running instances.", inputSchema: { type: "object", properties: appArg, required: ["app"] }, call: (a) => ["GET", "apps/" + seg(a.app) + "/logs"] },
  { name: "set_app_env", title: "Set environment variables", write: true, description: "Sets (or with a null value removes) environment variables and restarts the app with them; no rebuild. Variables listed in `secret` are stored as secrets.",
    inputSchema: { type: "object", properties: { ...appArg, vars: { type: "object", description: "KEY → value (string) or null to remove", additionalProperties: { type: ["string", "null"] } }, secret: { type: "array", items: { type: "string" }, description: "Keys to store as secrets" } }, required: ["app", "vars"] },
    call: (a) => ["PUT", "apps/" + seg(a.app) + "/env", { vars: a.vars, secret: a.secret ?? [] }] },
  { name: "app_action", title: "Start / stop / restart app", write: true, description: "Power action on an app.", inputSchema: { type: "object", properties: { ...appArg, action: str("start, stop or restart", { enum: ["start", "stop", "restart"] }) }, required: ["app", "action"] },
    call: (a) => ["POST", "apps/" + seg(a.app) + "/actions", { action: a.action }] },
  { name: "run_job", title: "Run one-off command", write: true, description: "Runs a one-off command (e.g. a database migration) in a new container from the app's live image, with the app's environment. Returns the job id; poll get_job for the output.",
    inputSchema: { type: "object", properties: { ...appArg, command: str("Shell command, e.g. `python manage.py migrate`") }, required: ["app", "command"] }, call: (a) => ["POST", "apps/" + seg(a.app) + "/jobs", { command: a.command }] },
  { name: "get_job", title: "Get job", description: "Status (running, succeeded, failed) and output of a one-off job started with run_job.", inputSchema: { type: "object", properties: { ...appArg, job_id: str("Job id (job-…)") }, required: ["app", "job_id"] }, call: (a) => ["GET", "apps/" + seg(a.app) + "/jobs/" + seg(a.job_id)] },
  { name: "list_databases", title: "List databases", description: "Managed databases (PostgreSQL, MySQL, MariaDB, MongoDB, Redis) with engine, status and size.", inputSchema: { type: "object", properties: {} }, call: () => ["GET", "databases"] },
  { name: "list_servers", title: "List servers", description: "Cloud servers (VPS) with status, IPs, size and location.", inputSchema: { type: "object", properties: {} }, call: () => ["GET", "servers"] },
  { name: "get_server", title: "Get server", description: "One cloud server.", inputSchema: { type: "object", properties: { server_id: str("Server id") }, required: ["server_id"] }, call: (a) => ["GET", "servers/" + seg(a.server_id)] },
  { name: "server_action", title: "Start / stop / reboot server", write: true, description: "Power action on a cloud server.", inputSchema: { type: "object", properties: { server_id: str("Server id"), action: str("start, stop or reboot", { enum: ["start", "stop", "reboot"] }) }, required: ["server_id", "action"] },
    call: (a) => ["POST", "servers/" + seg(a.server_id) + "/actions", { action: a.action }] },
  { name: "list_domains", title: "List domains", description: "Registered domains with status, name servers and expiry.", inputSchema: { type: "object", properties: {} }, call: () => ["GET", "domains"] },
  { name: "list_dns_records", title: "List DNS records", description: "DNS records of a domain.", inputSchema: { type: "object", properties: { domain_id: str("Domain id from list_domains") }, required: ["domain_id"] }, call: (a) => ["GET", "domains/" + seg(a.domain_id) + "/records"] },
  { name: "add_dns_record", title: "Add DNS record", write: true, description: "Adds a DNS record (A, AAAA, CNAME, MX, TXT, NS, SRV, CAA) to a domain.",
    inputSchema: { type: "object", properties: { domain_id: str("Domain id"), type: str("Record type"), name: str("Name: @ for the apex, or a subdomain label"), value: str("Value"), ttl: { type: "integer", description: "TTL in seconds (default 3600)" }, priority: { type: "integer", description: "MX/SRV priority" } }, required: ["domain_id", "type", "name", "value"] },
    call: (a) => ["POST", "domains/" + seg(a.domain_id) + "/records", { type: a.type, name: a.name, value: a.value, ttl: a.ttl, priority: a.priority }] },
  { name: "delete_dns_record", title: "Delete DNS record", write: true, description: "Removes a DNS record.", inputSchema: { type: "object", properties: { domain_id: str("Domain id"), record_id: str("Record id") }, required: ["domain_id", "record_id"] },
    call: (a) => ["DELETE", "domains/" + seg(a.domain_id) + "/records/" + seg(a.record_id)] },
  { name: "list_invoices", title: "List invoices", description: "Invoices with status and total in Toman.", inputSchema: { type: "object", properties: {} }, call: () => ["GET", "invoices"] },
];

type RpcMsg = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Json };
const ok = (id: RpcMsg["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const err = (id: RpcMsg["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** runs one public API route as the token's user */
export async function callRoute(ctx: Ctx, scope: string, method: string, path: string, body: Json = {}) {
  const route = ROUTES.find((r) => r.method === method && r.pattern.test(path));
  if (!route) throw new AppError("Not found", 404);
  if (route.write && scope !== "read-write") throw new AppError("This token is read-only; create a read-write token in Panel › SSH و API.", 403);
  const clean = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
  return route.run(ctx, route.pattern.exec(path)!, clean);
}

async function callTool(ctx: Ctx, scope: string, name: string, args: Json) {
  const tool = MCP_TOOLS.find((t) => t.name === name);
  if (!tool) return null;
  for (const k of tool.inputSchema.required ?? []) if (args[k] === undefined || args[k] === "") return toolError("Missing argument: " + k);
  try {
    const [method, path, body] = tool.call(args);
    const out = await callRoute(ctx, scope, method, path, body);
    const structured = out && typeof out === "object" && !Array.isArray(out) ? (out as Json) : { result: out };
    return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }], structuredContent: structured, isError: false };
  } catch (e) {
    if (e instanceof AppError) return toolError(e.message + " (HTTP " + e.status + ")");
    if (e instanceof ZodError) return toolError("Invalid arguments: " + e.issues.map((i) => i.path.join(".") + ": " + i.message).join("; "));
    throw e;
  }
}
const toolError = (text: string) => ({ content: [{ type: "text", text }], isError: true });

/** one JSON-RPC message; notifications (no id) return null */
export async function handleMcp(ctx: Ctx, scope: string, msg: RpcMsg) {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return err(msg?.id, -32600, "Invalid Request");
  const isNote = msg.id === undefined;
  const p = msg.params ?? {};
  switch (msg.method) {
    case "initialize": {
      const want = String(p.protocolVersion ?? "");
      return ok(msg.id, {
        protocolVersion: MCP_PROTOCOLS.includes(want) ? want : MCP_PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: "Gereh Cloud (Iran): apps (PaaS), managed databases, cloud servers, domains/DNS and invoices of the signed-in account. Prices are in Toman. "
          + "Deploy with deploy_app, then poll get_deployment every few seconds until status is live or failed and read its log on failure. "
          + (scope === "read-write" ? "" : "This token is read-only: write tools will fail."),
      });
    }
    case "ping": return isNote ? null : ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, { tools: MCP_TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: { title: t.title, readOnlyHint: !t.write, destructiveHint: !!t.write && /delete|action/.test(t.name), openWorldHint: false } })) });
    case "tools/call": {
      const r = await callTool(ctx, scope, String(p.name ?? ""), (p.arguments as Json) ?? {});
      return r ? ok(msg.id, r) : err(msg.id, -32602, "Unknown tool: " + String(p.name));
    }
    case "resources/list": return ok(msg.id, { resources: [] });
    case "prompts/list": return ok(msg.id, { prompts: [] });
    default:
      if (isNote || msg.method.startsWith("notifications/")) return null;
      return err(msg.id, -32601, "Method not found: " + msg.method);
  }
}

/** HTTP entry: POST one message or a batch */
export async function mcpHttp(base: Omit<Ctx, "auth">, req: Request): Promise<Response> {
  const H = { "cache-control": "no-store" };
  if (req.method === "GET") return new Response(null, { status: 405, headers: { ...H, allow: "POST" } }); // no server-initiated stream
  if (req.method === "DELETE") return new Response(null, { status: 204, headers: H }); // stateless: nothing to end
  let auth;
  try { auth = await tokenAuth(base, req.headers.get("authorization")); }
  catch (e) {
    const status = e instanceof AppError ? e.status : 401;
    return Response.json(err(null, -32001, (e as Error).message + ". Create a token in Panel › SSH و API and send it as `Authorization: Bearer grh_…`."), { status, headers: { ...H, "www-authenticate": 'Bearer realm="gereh"' } });
  }
  const body = await req.json().catch(() => undefined);
  if (body === undefined) return Response.json(err(null, -32700, "Parse error"), { status: 400, headers: H });
  const ctx = { ...base, auth: auth.auth };
  const msgs = Array.isArray(body) ? body : [body];
  const out = [];
  for (const m of msgs as RpcMsg[]) {
    try { const r = await handleMcp(ctx, auth.scope, m); if (r) out.push(r); }
    catch (e) { console.error("[mcp]", e); out.push(err(m?.id, -32603, "Internal error")); }
  }
  if (!out.length) return new Response(null, { status: 202, headers: H });
  return Response.json(Array.isArray(body) ? out : out[0], { headers: H });
}
