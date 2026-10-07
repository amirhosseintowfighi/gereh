import { beforeEach, describe, expect, it } from "vitest";
import { GET, POST, DELETE } from "@/app/api/v1/[[...path]]/route";
import { asUser, call, fresh } from "./helpers";

beforeEach(fresh);
const req = (method: string, path: string, token?: string, body?: unknown) =>
  new Request("http://localhost/api/v1/" + path, { method, headers: { ...(token ? { authorization: "Bearer " + token } : {}), "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
const ctx = (path: string) => ({ params: Promise.resolve({ path: path.split("/") }) });
const run = async (fn: typeof GET, method: string, path: string, token?: string, body?: unknown) => {
  const res = await fn(req(method, path, token, body), ctx(path) as never);
  return { status: res.status, body: await res.json() };
};

describe("public API v1", () => {
  it("rejects missing and bogus tokens", async () => {
    expect((await run(GET, "GET", "servers")).status).toBe(401);
    expect((await run(GET, "GET", "servers", "grh_" + "x".repeat(40))).status).toBe(401);
  });

  it("lists only the token owner's servers and performs actions with a read-write token", async () => {
    await asUser();
    const rw = await call<string>("account.createToken", { name: "ci", scope: "read-write", expires: "۹۰ روز" });
    const r = await run(GET, "GET", "servers", rw);
    expect(r.status).toBe(200);
    expect(r.body.data.map((s: { id: string }) => s.id).sort()).toEqual(["srv-1042", "srv-1043", "srv-1101"]);
    expect(r.body.data[0]).toHaveProperty("ipv4");
    expect((await run(GET, "GET", "servers/srv-1200", rw)).status).toBe(404);
    expect((await run(POST, "POST", "servers/srv-1042/actions", rw, { action: "stop" })).body).toEqual({ ok: true });
    expect((await run(POST, "POST", "servers/srv-1042/actions", rw, { action: "explode" })).status).toBe(422);
  });

  it("read tokens cannot write", async () => {
    await asUser();
    const ro = await call<string>("account.createToken", { name: "ro", scope: "read", expires: "۳۰ روز" });
    expect((await run(GET, "GET", "account", ro)).body).toMatchObject({ id: "u1", email: "demo@gereh.cloud" });
    expect((await run(POST, "POST", "servers/srv-1042/actions", ro, { action: "stop" })).status).toBe(403);
  });

  it("DNS records CRUD with validation", async () => {
    await asUser();
    const rw = await call<string>("account.createToken", { name: "tf", scope: "read-write", expires: "یک سال" });
    const created = await run(POST, "POST", "domains/dom-501/records", rw, { type: "A", name: "api", value: "1.2.3.4", ttl: 300 });
    expect(created.body).toMatchObject({ type: "A", name: "api", value: "1.2.3.4", ttl: 300 });
    expect((await run(POST, "POST", "domains/dom-501/records", rw, { type: "A", name: "bad", value: "nope" })).status).toBe(422);
    const del = await run(DELETE, "DELETE", "domains/dom-501/records/" + created.body.id, rw);
    expect(del.body).toEqual({ ok: true });
  });

  it("serves the OpenAPI document without auth", async () => {
    const r = await run(GET, "GET", "openapi.json");
    expect(r.body.openapi).toBe("3.1.0");
    expect(Object.keys(r.body.paths)).toContain("/servers/{id}/actions");
  });
});
