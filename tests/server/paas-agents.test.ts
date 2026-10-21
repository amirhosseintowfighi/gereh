/* eslint-disable @typescript-eslint/no-explicit-any -- assertions walk deeply nested manifest JSON */
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ENV_KEY_RE, ENV_RESERVED } from "@/lib/paas";
import { n8nRunners, proxyEnv, runnersMemory } from "@/lib/paas-egress";
import { PAAS_TEMPLATES, templateOf, VPS_ONLY_APPS } from "@/lib/paas-templates";
import { aiEndpoint } from "@/server/ai/state";
import { activity, aiKeys, paasApps, paasDeployments, paasEgress } from "@/server/db/schema";
import type { AppSpec } from "@/server/paas/driver";
import { appObjects } from "@/server/paas/kubernetes";
import { appSpec } from "@/server/paas/service";
import { drain } from "@/server/worker";
import { asAdmin, asUser, call, db, fails, fresh } from "./helpers";

beforeAll(() => { process.env.PAAS_SIM_BUILD_SECONDS = "0"; process.env.PAAS_POLL_MS = "0"; });
beforeEach(fresh);
const settle = async () => { for (let i = 0; i < 12; i++) if (!(await drain(await db()))) break; };
const row = async (id: string) => (await (await db()).select().from(paasApps).where(eq(paasApps.id, id)))[0];
type Created = { appId: string; credentials: { label: string; value: string }[] };

const spec = (over: Partial<AppSpec> = {}): AppSpec => ({
  id: "app-n8n", userId: "u1", name: "flow", stack: "docker", source: "image", gitUrl: "", gitBranch: "main", image: "n8nio/n8n:2.44.5", rootDir: "", buildCommand: "", startCommand: "",
  port: 5678, healthPath: "/healthz", cpu: 1, ramMb: 1024, instances: 1, autoscale: false, maxInstances: 1, autoscaleCpu: 70, diskGb: 5, diskMount: "/home/node/.n8n",
  env: { PORT: "5678", TZ: "Asia/Tehran" }, hosts: ["flow.gereh.dev"], cdn: false, cacheVersion: 1, releaseCommand: "", processes: [], crons: [], ...over,
});
const manifest = (s: AppSpec, image = s.image) => {
  const objs = appObjects(s, image, "dep-1") as any[];
  return { secret: objs.find((o) => o.kind === "Secret" && o.metadata.name === s.name + "-env"), pod: objs.find((o) => o.kind === "Deployment" && o.metadata.name === s.name).spec.template.spec };
};

describe("n8n task runners sidecar", () => {
  it("runs n8nio/runners of the same version beside n8n, with a shared token and the broker on loopback", () => {
    const { secret, pod } = manifest(spec());
    const [main, runners] = pod.containers;
    expect(pod.containers.map((c: any) => c.name)).toEqual(["app", "runners"]);
    expect(runners.image).toBe("n8nio/runners:2.44.5");
    expect(secret.stringData).toMatchObject({ N8N_RUNNERS_MODE: "external", N8N_RUNNERS_BROKER_LISTEN_ADDRESS: "127.0.0.1" });
    expect(secret.stringData.N8N_RUNNERS_AUTH_TOKEN).toMatch(/^[\w-]{40,}$/);
    expect(secret.stringData.N8N_RUNNERS_ENABLED).toBeUndefined(); // 2.x: always on
    const env = Object.fromEntries(runners.env.map((e: any) => [e.name, e.value ?? e.valueFrom]));
    expect(env.N8N_RUNNERS_TASK_BROKER_URI).toBe("http://127.0.0.1:5679");
    expect(env.N8N_RUNNERS_AUTH_TOKEN).toEqual({ secretKeyRef: { name: "flow-env", key: "N8N_RUNNERS_AUTH_TOKEN" } });
    expect(env.N8N_RUNNERS_AUTO_SHUTDOWN_TIMEOUT).toBe("15");
    // the sidecar's memory is carved out of the plan; no port of the broker is published
    expect(main.resources.limits.memory).toBe("768Mi");
    expect(runners.resources.limits.memory).toBe("256Mi");
    expect(runners.ports).toBeUndefined();
    expect(main.ports).toEqual([{ name: "http", containerPort: 5678 }]);
    // the token is stable per app and differs between apps
    expect(manifest(spec()).secret.stringData.N8N_RUNNERS_AUTH_TOKEN).toBe(secret.stringData.N8N_RUNNERS_AUTH_TOKEN);
    expect(manifest(spec({ id: "app-other" })).secret.stringData.N8N_RUNNERS_AUTH_TOKEN).not.toBe(secret.stringData.N8N_RUNNERS_AUTH_TOKEN);
  });

  it("1.x opts in, and other images, unpinned tags, small plans and the customer's internal mode get none", () => {
    const one = manifest(spec(), "n8nio/n8n:1.123.85");
    expect(one.pod.containers[1].image).toBe("n8nio/runners:1.123.85");
    expect(one.secret.stringData).toMatchObject({ N8N_RUNNERS_ENABLED: "true", N8N_NATIVE_PYTHON_RUNNER: "true" });
    expect(n8nRunners("docker.n8n.io/n8nio/n8n:2.45.0")?.image).toBe("n8nio/runners:2.45.0");
    for (const img of ["n8nio/n8n:latest", "n8nio/n8n:1.100.0", "nginx:1.29", "evil/n8nio/n8n:2.44.5"]) expect(n8nRunners(img), img).toBeNull();
    expect(manifest(spec({ ramMb: 256 })).pod.containers).toHaveLength(1);
    expect(runnersMemory(512)).toBe(128);
    expect(runnersMemory(8192)).toBe(512);
    const own = manifest(spec({ env: { PORT: "5678", N8N_RUNNERS_MODE: "internal" } }));
    expect(own.pod.containers).toHaveLength(1);
    expect(own.secret.stringData.N8N_RUNNERS_AUTH_TOKEN).toBeUndefined();
    const token = manifest(spec({ env: { PORT: "5678", N8N_RUNNERS_AUTH_TOKEN: "mine" } }));
    expect(token.secret.stringData.N8N_RUNNERS_AUTH_TOKEN).toBe("mine");
  });

  it("an existing n8n app gets the sidecar on its next deploy (derived from the released image, no migration)", async () => {
    await asUser();
    // an app made before this change: just the official image
    const appId = await call<string>("paas.createApp", { name: "old-flow", stack: "docker", source: "image", image: "n8nio/n8n:2.44.0", port: 5678, planId: "app-small", diskGb: 5 });
    await settle();
    await call("paas.deploy", appId, {});
    await settle();
    const app = await row(appId);
    const [live] = await (await db()).select().from(paasDeployments).where(eq(paasDeployments.id, app.liveDeployment!));
    const s = await appSpec(await db(), app);
    const image = live.image.startsWith("registry.gereh.net") ? app.image : live.image; // the simulator tags every build
    const { pod, secret } = manifest(s, image);
    expect(pod.containers[1].image).toBe("n8nio/runners:2.44.0");
    expect(secret.stringData.N8N_RUNNERS_MODE).toBe("external");
  });

  it("the n8n template defaults to the latest stable release and keeps the previous one and the 1.x line", () => {
    const t = templateOf("n8n")!;
    expect(t.image).toBe("n8nio/n8n:2.44.5");
    expect(t.versions).toEqual(["2.44.5", "2.44.0", "1.123.85"]);
    for (const v of t.versions!) expect(n8nRunners("n8nio/n8n:" + v)?.version).toBe(v);
  });
});

describe("outbound proxy", () => {
  it("injects HTTP(S)_PROXY, ALL_PROXY and NO_PROXY (both cases) with internal hosts direct; absent when off", async () => {
    await asUser();
    const r = await call<Created>("paas.createFromTemplate", "librechat", "chat-x", "", "", { llm: { mode: "custom", baseUrl: "https://llm.example.com/v1", apiKey: "k" } });
    await settle();
    let app = await row(r.appId);
    let env = (await appSpec(await db(), app)).env;
    expect(env.HTTPS_PROXY).toBeUndefined();
    expect(env.NO_PROXY).toBeUndefined();

    expect(await fails("paas.setEgress", r.appId, { mode: "custom", url: "ftp://x", noProxy: [] })).toContain("پروکسی");
    expect(await fails("paas.setEgress", r.appId, { mode: "custom", url: null, noProxy: [] })).toContain("نشانی پروکسی");
    expect(await fails("paas.setEgress", r.appId, { mode: "platform", url: null, noProxy: [] })).toContain("پروکسی گره");
    const dep = await call<string | null>("paas.setEgress", r.appId, { mode: "custom", url: "http://bob:s3cret@203.0.113.7:3128", noProxy: ["api.example.ir"] });
    expect(dep).toBeTruthy(); // re-released with the new env
    const view = await call<{ url: string; mode: string }>("paas.egress", r.appId);
    expect(view).toMatchObject({ mode: "custom", url: "http://***@203.0.113.7:3128" });
    app = await row(r.appId);
    env = (await appSpec(await db(), app)).env;
    for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) expect(env[k], k).toBe("http://bob:s3cret@203.0.113.7:3128");
    expect(env.NODE_USE_ENV_PROXY).toBe("1");
    const no = env.NO_PROXY.split(",");
    expect(env.no_proxy).toBe(env.NO_PROXY);
    expect(no).toEqual(expect.arrayContaining(["localhost", "127.0.0.1", ".svc", ".cluster.local", "10.0.0.0/8", ".gereh.dev", "api.example.ir", new URL(aiEndpoint()).hostname]));
    // the linked MongoDB stays direct
    expect(no.some((h) => h.includes(".db.gereh.internal"))).toBe(true);
    // the proxy URL (with its password) is never in the activity log
    expect(JSON.stringify(await (await db()).select().from(activity))).not.toContain("s3cret");

    // SOCKS5: no Node env proxy (it only speaks HTTP proxies); the customer's own variable wins
    await call("paas.setEgress", r.appId, { mode: "custom", url: "socks5h://203.0.113.7:1080", noProxy: [] });
    await call("paas.setEnv", r.appId, [{ key: "HTTPS_PROXY", value: "http://own:1", secret: false }], []);
    env = (await appSpec(await db(), await row(r.appId))).env;
    expect(env.ALL_PROXY).toBe("socks5h://203.0.113.7:1080");
    expect(env.HTTPS_PROXY).toBe("http://own:1");
    expect(env.NODE_USE_ENV_PROXY).toBeUndefined();

    await call("paas.setEgress", r.appId, { mode: "off", url: null, noProxy: [] });
    env = (await appSpec(await db(), await row(r.appId))).env;
    expect(env.ALL_PROXY).toBeUndefined();
    expect(env.NO_PROXY).toBeUndefined();
  });

  it("the template's «پروکسی گره» checkbox uses the admin's platform proxy, also for TELEGRAM_PROXY", async () => {
    await asUser();
    expect((await call<{ available: boolean }>("paas.platformProxy")).available).toBe(false);
    const opts = { inputs: { HERMES_DEFAULT_MODEL: "some-model" }, proxy: true };
    expect(await fails("paas.createFromTemplate", "hermes", "agent-a", "", "", opts)).toContain("پروکسی گره");
    expect(await fails("paas.adminSetEgress", { url: "http://10.1.2.3:3128", noProxy: [] })).toBeTruthy();

    await asAdmin();
    expect(await fails("paas.adminSetEgress", { url: "nope", noProxy: [] })).toContain("پروکسی");
    await call("paas.adminSetEgress", { url: "http://gw:pw@10.1.2.3:3128", noProxy: [".ir"] });
    expect(await call("paas.adminEgress")).toMatchObject({ url: "http://***@10.1.2.3:3128", source: "admin", noProxy: [".ir"] });

    await asUser();
    expect((await call<{ available: boolean }>("paas.platformProxy")).available).toBe(true);
    const r = await call<Created>("paas.createFromTemplate", "hermes", "agent-a", "", "", opts);
    const [eg] = await (await db()).select().from(paasEgress).where(eq(paasEgress.appId, r.appId));
    expect(eg).toMatchObject({ mode: "platform", extraKeys: ["TELEGRAM_PROXY"], proxyEnc: "" });
    await settle();
    let env = (await appSpec(await db(), await row(r.appId))).env;
    expect(env.HTTPS_PROXY).toBe("http://gw:pw@10.1.2.3:3128");
    expect(env.TELEGRAM_PROXY).toBe("http://gw:pw@10.1.2.3:3128");
    expect(env.NO_PROXY.split(",")).toContain(".ir");

    // the admin's value applies on the next deploy of every app that uses it
    await asAdmin();
    await call("paas.adminSetEgress", { url: "socks5h://10.9.9.9:1080", noProxy: [] });
    await asUser();
    env = (await appSpec(await db(), await row(r.appId))).env;
    expect(env.TELEGRAM_PROXY).toBe("socks5h://10.9.9.9:1080");
    // without the checkbox the app keeps TELEGRAM_PROXY wiring for its own proxy later, but nothing is injected
    const plain = await call<Created>("paas.createFromTemplate", "hermes", "agent-b", "", "", { inputs: { HERMES_DEFAULT_MODEL: "some-model" } });
    expect((await appSpec(await db(), await row(plain.appId))).env.TELEGRAM_PROXY).toBeUndefined();
    await call("paas.setEgress", plain.appId, { mode: "custom", url: "http://198.51.100.1:8080", noProxy: [] });
    expect((await appSpec(await db(), await row(plain.appId))).env.TELEGRAM_PROXY).toBe("http://198.51.100.1:8080");
  });

  it("proxyEnv builds the full variable set", () => {
    const e = proxyEnv("http://p:1", ["a", "b"], ["X_PROXY"]);
    expect(e).toMatchObject({ HTTP_PROXY: "http://p:1", https_proxy: "http://p:1", NO_PROXY: "a,b", no_proxy: "a,b", X_PROXY: "http://p:1", NODE_USE_ENV_PROXY: "1" });
  });
});

describe("agent apps", () => {
  it("Hermes: Telegram token, Gereh AI key and base URL, dashboard on a port with its own login, disk and PID-1 entrypoint", async () => {
    await asUser();
    expect(await fails("paas.createFromTemplate", "hermes", "herm", "", "", { inputs: {} })).toContain("مدل");
    expect(await fails("paas.createFromTemplate", "hermes", "herm", "", "", { inputs: { HERMES_DEFAULT_MODEL: "m", TELEGRAM_BOT_TOKEN: "not-a-token" } })).toContain("توکن");
    expect(await fails("paas.createFromTemplate", "hermes", "herm", "", "", { inputs: { HERMES_DEFAULT_MODEL: "m" }, llm: { mode: "custom", baseUrl: "javascript:alert(1)" } })).toContain("نشانی");
    const token = "123456789:" + "A".repeat(35);
    const r = await call<Created>("paas.createFromTemplate", "hermes", "herm", "", "", { inputs: { HERMES_DEFAULT_MODEL: "some-model", TELEGRAM_BOT_TOKEN: token, TELEGRAM_ALLOWED_USERS: "111222333, 444555666" } });
    expect(r.credentials.map((c) => c.label)).toEqual(["رمز داشبورد (کاربر admin)"]);
    await settle();
    const app = await row(r.appId);
    expect(app).toMatchObject({ image: "nousresearch/hermes-agent:v0.22.2", port: 9119, diskGb: 5, diskMount: "/opt/data", planId: "app-small" });
    const s = await appSpec(await db(), app);
    expect(s.env).toMatchObject({ TELEGRAM_BOT_TOKEN: token, HERMES_DEFAULT_MODEL: "some-model", OPENAI_BASE_URL: aiEndpoint() + "/v1", HERMES_DASHBOARD: "1", HERMES_DASHBOARD_PUBLIC_URL: "https://herm.gereh.dev" });
    expect(s.env.OPENAI_API_KEY).toMatch(/^gk-[A-Za-z0-9]{40}$/);
    const keys = await (await db()).select().from(aiKeys).where(eq(aiKeys.userId, app.userId));
    expect(keys.some((k) => k.name === "اپ herm")).toBe(true);
    const objs = appObjects(s, app.image, "dep-h") as any[];
    const c = objs.find((o) => o.kind === "Deployment").spec.template.spec.containers[0];
    expect(c.ports).toEqual([{ name: "http", containerPort: 9119 }]);
    expect(c.command[2]).toMatch(/exec \/opt\/hermes\/docker\/entrypoint-dispatch\.sh gateway run$/);
    expect(c.command[2]).toContain("key_env: OPENAI_API_KEY");
    expect(c.volumeMounts).toEqual([{ name: "data", mountPath: "/opt/data" }]);
    expect(objs.some((o) => o.kind === "PersistentVolumeClaim")).toBe(true);
    // a failed creation does not leave the generated AI key behind
    const before = (await (await db()).select().from(aiKeys)).length;
    expect(await fails("paas.createFromTemplate", "hermes", "herm", "", "", { inputs: { HERMES_DEFAULT_MODEL: "m" } })).toContain("گرفته شده");
    expect((await (await db()).select().from(aiKeys)).length).toBe(before);
  });

  it("LibreChat and Agent Zero wire the model backend; the new templates are well formed", async () => {
    await asUser();
    const lc = await call<Created>("paas.createFromTemplate", "librechat", "lchat", "", "", { llm: { mode: "custom", baseUrl: "https://llm.example.com/v1/", apiKey: "sk-x" } });
    const a0 = await call<Created>("paas.createFromTemplate", "agent-zero", "zero", "", "", {});
    await settle();
    const lcEnv = (await appSpec(await db(), await row(lc.appId))).env;
    expect(lcEnv).toMatchObject({ OPENAI_REVERSE_PROXY: "https://llm.example.com/v1", OPENAI_API_KEY: "sk-x", DOMAIN_CLIENT: "https://lchat.gereh.dev" });
    expect(lcEnv.MONGO_URI).toMatch(/^mongodb:\/\//);
    expect(lcEnv.CREDS_KEY).toMatch(/^[0-9a-f]{64}$/);
    expect(lcEnv.CREDS_IV).toMatch(/^[0-9a-f]{32}$/);
    const a0Env = (await appSpec(await db(), await row(a0.appId))).env;
    expect(a0Env.API_KEY_OTHER).toMatch(/^gk-/);
    expect(a0.credentials[0].value.length).toBeGreaterThan(20);

    for (const id of ["hermes", "librechat", "agent-zero"]) expect(templateOf(id), id).toBeTruthy();
    for (const id of ["dify", "openhands"]) expect(VPS_ONLY_APPS.some((v) => v.id === id)).toBe(true);
    for (const t of PAAS_TEMPLATES) {
      const keys = [...(t.inputs ?? []).map((i) => i.key), ...(t.llm ? [t.llm.keyEnv, ...(t.llm.baseEnv ? [t.llm.baseEnv] : [])] : [])];
      expect(new Set([...keys, ...Object.keys(t.env)]).size, t.id).toBe(keys.length + Object.keys(t.env).length);
      for (const k of [...keys, ...(t.proxyEnv ?? [])]) { expect(ENV_KEY_RE.test(k), k).toBe(true); expect(ENV_RESERVED.has(k), k).toBe(false); }
      for (const i of t.inputs ?? []) if (i.pattern) expect(() => new RegExp(i.pattern!)).not.toThrow();
      if (t.proxyEnv) expect(t.needsProxy).toBe(true);
    }
  });
});
