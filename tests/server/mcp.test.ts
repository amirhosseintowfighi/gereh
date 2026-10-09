import { beforeEach, describe, expect, it } from "vitest";
import { POST, GET } from "@/app/api/mcp/route";
import { asUser, call, fresh } from "./helpers";

beforeEach(fresh);
const rpc = async (token: string | null, body: unknown) => {
  const res = await POST(new Request("http://localhost/api/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(token ? { authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body) }));
  return { status: res.status, body: res.status === 202 ? null : await res.json() };
};
const tool = async (token: string, name: string, args: Record<string, unknown> = {}) => (await rpc(token, { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: args } })).body.result;

describe("MCP server", () => {
  it("needs a bearer token and speaks the initialize handshake", async () => {
    const no = await rpc(null, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(no.status).toBe(401);
    expect((await GET(new Request("http://localhost/api/mcp"))).status).toBe(405);
    await asUser();
    const t = await call<string>("account.createToken", { name: "agent", scope: "read", expires: "۳۰ روز" });
    const init = await rpc(t, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    expect(init.body.result).toMatchObject({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "gereh" } });
    expect((await rpc(t, { jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    const list = (await rpc(t, { jsonrpc: "2.0", id: 2, method: "tools/list" })).body.result.tools;
    expect(list.map((x: { name: string }) => x.name)).toContain("deploy_app");
    expect(list.find((x: { name: string }) => x.name === "list_apps").annotations.readOnlyHint).toBe(true);
    expect((await rpc(t, { jsonrpc: "2.0", id: 3, method: "nope" })).body.error.code).toBe(-32601);
    const batch = (await rpc(t, [{ jsonrpc: "2.0", id: 4, method: "ping" }, { jsonrpc: "2.0", method: "notifications/x" }])).body;
    expect(batch).toEqual([{ jsonrpc: "2.0", id: 4, result: {} }]);
  });

  it("tools run as the token owner and respect read-only scope", async () => {
    await asUser();
    const ro = await call<string>("account.createToken", { name: "ro", scope: "read", expires: "۳۰ روز" });
    const rw = await call<string>("account.createToken", { name: "rw", scope: "read-write", expires: "۳۰ روز" });
    const acct = await tool(ro, "get_account");
    expect(acct.isError).toBe(false);
    expect(acct.structuredContent).toMatchObject({ id: "u1" });
    const apps = await tool(ro, "list_apps");
    expect(apps.structuredContent.data.length).toBeGreaterThan(0);
    const app = apps.structuredContent.data[0].name;
    const denied = await tool(ro, "app_action", { app, action: "restart" });
    expect(denied.isError).toBe(true);
    expect(denied.content[0].text).toContain("read-only");
    expect((await tool(rw, "get_app", {})).isError).toBe(true); // missing argument
    expect((await tool(rw, "get_app", { app: "not-mine" })).content[0].text).toContain("404");
    const dbs = await tool(ro, "list_databases");
    expect(Array.isArray(dbs.structuredContent.data)).toBe(true);
    expect((await rpc(rw, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "rm_rf" } })).body.error.code).toBe(-32602);
  });
});
