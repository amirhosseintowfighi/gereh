import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MIRROR_ECOSYSTEMS, MIRROR_GROUPS, mirrorSetupScript } from "@/lib/mirror";
import { DB_ENGINES, detectStack, ENV_KEY_RE, ENV_RESERVED, IMAGE_RE, RUNTIMES, STACKS, stackDefaultVersion, stackVersions } from "@/lib/paas";
import { versionBuild } from "@/lib/paas-build";
import { fillStackValue, parseStack, STACK_GALLERY, stackFromCompose, StackError } from "@/lib/paas-stack";
import { dbMap, fillTemplate, PAAS_TEMPLATES, parseDbMap, TEMPLATE_CATEGORIES, templateImage, templateOf, templateTag, VPS_ONLY_APPS } from "@/lib/paas-templates";

const ICONS = new Set([...readFileSync("src/components/icon.tsx", "utf8").matchAll(/"([a-z0-9-]+)":"</g)].map((m) => m[1]));
const PLANS = new Set(["app-nano", "app-micro", "app-small", "app-medium", "app-large", "app-xlarge"]);
const files = (o: Record<string, string | null>) => new Map(Object.entries(o));

describe("one-click templates", () => {
  it("has about 80 apps with unique ids", () => {
    expect(PAAS_TEMPLATES.length).toBeGreaterThanOrEqual(75);
    const ids = [...PAAS_TEMPLATES, ...VPS_ONLY_APPS].map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]{1,30}$/);
  });

  it.each(PAAS_TEMPLATES.map((t) => [t.id, t] as const))("%s is well formed", (_, t) => {
    for (const k of ["name", "category", "icon", "desc", "image", "next", "docs", "planId", "diskMount"] as const) expect(t[k], k).toBeTruthy();
    expect(TEMPLATE_CATEGORIES).toContain(t.category);
    expect(ICONS.has(t.icon), "icon " + t.icon).toBe(true);
    expect(Number.isInteger(t.port) && t.port > 0 && t.port < 65536).toBe(true);
    expect(PLANS.has(t.planId)).toBe(true);
    expect(t.diskGb >= 0 && t.diskGb <= 50).toBe(true);
    expect(t.diskMount.startsWith("/")).toBe(true);
    expect(t.docs).toMatch(/^https:\/\//);
    if (t.health) expect(t.health).toMatch(/^\/[\w./?=&%-]*$/);
    // a pinned tag of an image the API accepts
    expect(IMAGE_RE.test(t.image), t.image).toBe(true);
    expect(t.image).toContain(":");
    if (t.versions) {
      expect(t.versions.length).toBeGreaterThan(0);
      expect(new Set(t.versions).size).toBe(t.versions.length);
      expect(t.versions).toContain(templateTag(t));
      for (const v of t.versions) expect(IMAGE_RE.test(templateImage(t, v)), v).toBe(true);
    }
    for (const k of Object.keys(t.env)) {
      expect(ENV_KEY_RE.test(k), k).toBe(true);
      expect(ENV_RESERVED.has(k), k).toBe(false);
    }
    for (const s of t.show ?? []) expect(t.env[s.key], s.key).toMatch(/\$\{(secret|hex|hex32)\}/);
    if (t.db) {
      expect(DB_ENGINES.find((e) => e.id === t.db!.engine)?.versions).toContain(t.db.version);
      expect(t.db.planId).toMatch(/^db-/);
      if (t.db.envKey.startsWith("@map:")) expect(parseDbMap(t.db.envKey)).not.toBeNull();
      else if (!t.db.envKey.startsWith("@parts:")) expect(ENV_KEY_RE.test(t.db.envKey)).toBe(true);
    }
  });

  it("VPS-only apps explain why and link to an install guide", () => {
    for (const id of ["supabase", "appwrite", "sentry", "gitlab"]) expect(VPS_ONLY_APPS.some((v) => v.id === id)).toBe(true);
    for (const v of VPS_ONLY_APPS) { expect(v.reason.length).toBeGreaterThan(20); expect(v.docs).toMatch(/^https:\/\//); expect(templateOf(v.id)).toBeUndefined(); }
  });

  it("picks version tags and fills placeholders", () => {
    const n8n = templateOf("n8n")!;
    expect(templateImage(n8n, "1.123.84")).toBe("n8nio/n8n:1.123.84");
    expect(templateImage(n8n, "9.9.9")).toBe(n8n.image);
    const v = fillTemplate("${url}|${host}|${email}|${secret}|${secret}|${hex}|${hex32}", { url: "https://a.gereh.dev", host: "a.gereh.dev", email: "x@y.ir" }).split("|");
    expect(v.slice(0, 3)).toEqual(["https://a.gereh.dev", "a.gereh.dev", "x@y.ir"]);
    expect(v[3]).toHaveLength(32);
    expect(v[3]).not.toBe(v[4]);
    expect(v[5]).toMatch(/^[0-9a-f]{64}$/);
    expect(v[6]).toMatch(/^[0-9a-f]{32}$/);
  });

  it("parses @map database links", () => {
    expect(parseDbMap(dbMap({ DB_HOST: "host", DSN: "url?sslmode=disable&x=1" }))).toEqual([{ env: "DB_HOST", field: "host", query: "" }, { env: "DSN", field: "url", query: "sslmode=disable&x=1" }]);
    for (const bad of ["DATABASE_URL", "@map:", "@map:A=nope", "@map:1A=host", "@map:A=host?x=1"]) expect(parseDbMap(bad)).toBeNull();
  });
});

describe("stacks and runtime versions", () => {
  it("offers the requested version ranges", () => {
    expect(stackVersions("node")).toEqual(expect.arrayContaining(["8", "24"]));
    expect(stackVersions("laravel")).toEqual(expect.arrayContaining(["7.2", "8.4"]));
    expect(stackVersions("django")).toEqual(expect.arrayContaining(["3.7", "3.13"]));
    expect(stackVersions("dotnet")).toEqual(expect.arrayContaining(["2.1", "10.0"]));
    expect(stackVersions("go")).toEqual(["1.25", "1.24", "1.23", "1.22", "1.21"]);
    expect(stackVersions("nextjs")).not.toContain("16");
    expect(stackVersions("fastapi")).not.toContain("3.7");
    expect(stackVersions("docker")).toEqual([]);
    for (const id of ["nextjs", "nuxt", "remix", "sveltekit", "astro", "wordpress", "flask", "ruby", "java", "rust", "deno", "bun", "elixir", "hugo", "jekyll", "gatsby", "eleventy", "angular", "vue", "react", "n8n", "docker"]) expect(STACKS.some((s) => s.id === id), id).toBe(true);
    for (const s of STACKS) if (s.runtime) expect(stackVersions(s.id)).toContain(stackDefaultVersion(s.id));
    for (const r of Object.values(RUNTIMES)) for (const v of r.nixpacks?.versions ?? []) expect(r.versions).toContain(v);
  });

  it("passes Nixpacks versions as its variable and builds the rest from official images", () => {
    expect(versionBuild("nextjs", "20")).toMatchObject({ nixEnv: { NIXPACKS_NODE_VERSION: "20" } });
    expect(versionBuild("node", undefined)).toBeNull();
    expect(versionBuild("node", "99")).toBeNull();
    expect(versionBuild("docker", "20")).toBeNull();
    const node8 = versionBuild("node", "8")!.dockerfile!;
    expect(node8).toMatch(/^FROM node:8-slim/);
    expect(node8).toContain("ARG NPM_CONFIG_REGISTRY");
    expect(versionBuild("react", "24")!.dockerfile).toContain("FROM nginx:");
    expect(versionBuild("laravel", "7.2")!.dockerfile).toContain("FROM php:7.2-apache");
    expect(versionBuild("laravel", "7.2")!.dockerfile).toContain("/var/www/html/public");
    expect(versionBuild("python", "3.7")!.dockerfile).toContain("FROM python:3.7-slim");
    expect(versionBuild("python", "3.12")).toMatchObject({ nixEnv: { NIXPACKS_PYTHON_VERSION: "3.12" } });
    const net = versionBuild("dotnet", "2.1")!.dockerfile!;
    expect(net).toContain("mcr.microsoft.com/dotnet/sdk:2.1");
    expect(net).toContain("mcr.microsoft.com/dotnet/aspnet:2.1");
    expect(versionBuild("go", "1.25")!.dockerfile).toContain("FROM golang:1.25 AS build");
    // Hugo and Jekyll have no Nixpacks provider: always the generated Dockerfile
    expect(versionBuild("hugo", undefined)!.dockerfile).toContain("hugo_extended_" + RUNTIMES.hugo.default + "_linux-amd64.tar.gz");
    expect(versionBuild("jekyll", undefined)!.dockerfile).toContain("jekyll build");
    expect(versionBuild("node", "8", { start: "node server.js" })!.dockerfile).toContain("CMD node server.js");
  });

  it.each([
    [{ "package.json": JSON.stringify({ dependencies: { vue: "3" }, devDependencies: { vite: "6" } }) }, "vue"],
    [{ "package.json": JSON.stringify({ dependencies: { gatsby: "5" } }) }, "gatsby"],
    [{ "package.json": JSON.stringify({ devDependencies: { "@11ty/eleventy": "3" } }) }, "eleventy"],
    [{ "package.json": JSON.stringify({ dependencies: { vite: "6", express: "5" } }) }, "node"],
    [{ "mix.exs": null }, "elixir"],
    [{ "Gemfile": "gem \"jekyll\", \"~> 4.3\"" }, "jekyll"],
    [{ "Gemfile": "gem \"rails\"" }, "ruby"],
    [{ "hugo.toml": null }, "hugo"],
    [{ "config.toml": null, "content/_index.md": null }, "hugo"],
  ])("detects %j as %s", (f, want) => expect(detectStack(files(f as Record<string, string | null>))).toBe(want));
});

describe("multi-service template («قالب ترکیبی»)", () => {
  it("every gallery sample is valid", () => {
    for (const g of STACK_GALLERY) {
      const p = parseStack(g.yaml);
      expect(p.apps[0].suffix, g.id).toBe("");
      for (const a of p.apps) if (a.image) expect(IMAGE_RE.test(a.image), a.image).toBe(true);
    }
  });

  it("links databases and keeps other variables for creation time", () => {
    const p = parseStack(STACK_GALLERY.find((g) => g.id === "n8n-queue")!.yaml);
    expect(p.databases.map((d) => d.id)).toEqual(["main", "queue"]);
    expect(p.apps.map((a) => a.suffix)).toEqual(["", "worker"]);
    expect(p.apps[1].start).toBe("exec n8n worker");
    expect(p.apps[0].env).toContainEqual({ key: "DB_POSTGRESDB_HOST", db: "main", field: "host" });
    expect(p.apps[0].env).toContainEqual({ key: "N8N_ENCRYPTION_KEY", value: "$RANDOM_STRING_key" });
    const shared = new Map<string, string>(), ctx = { name: "flow", url: "https://flow.gereh.dev", host: "flow.gereh.dev", shared };
    const k1 = fillStackValue("$RANDOM_STRING_key", ctx), k2 = fillStackValue("$RANDOM_STRING_key", ctx);
    expect(k1).toBe(k2);
    expect(k1).toHaveLength(64);
    expect(fillStackValue("$RANDOM_STRING", ctx)).not.toBe(fillStackValue("$RANDOM_STRING", ctx));
    expect(fillStackValue("$APP_URL/hook?x=$APP_NAME", ctx)).toBe("https://flow.gereh.dev/hook?x=flow");
    expect(fillStackValue("$RANDOM_HEX", ctx)).toMatch(/^[0-9a-f]{32}$/);
    expect(atob(fillStackValue("$RANDOM_BASE64", ctx))).toHaveLength(32);
  });

  it.each([
    ["apps: []", "دست‌کم یک اپ"],
    ["apps:\n  - image: nginx:1\n    git: https://github.com/a/b.git", "دقیقاً یکی"],
    ["apps:\n  - image: 'Bad Image'", "معتبر نیست"],
    ["apps:\n  - image: nginx:1\n    env: { A: $DB_x_URL }", "تعریف نشده"],
    ["databases: [{ id: m, engine: postgres }]\napps:\n  - image: nginx:1\n    env: { A: postgres://$DB_m_URL }", "کل مقدار"],
    ["databases: [{ id: m, engine: nope }]\napps: [{ image: 'nginx:1' }]", "پشتیبانی نمی‌شود"],
    ["apps:\n  - image: nginx:1\n    env: { PORT: '1' }", "پلتفرم"],
    ["apps:\n  - image: nginx:1\n    env: { A: $APP_SECRET }", "شناخته نشد"],
    ["apps:\n  - name: $APP_NAME-x\n    image: nginx:1", "اپ اول"],
    ["apps:\n  - image: nginx:1\n    port: 70000", "پورت"],
    ["apps:\n  - image: nginx:1\n    disk: { size: 5, mount: data }", "مطلق"],
    ["apps:\n  - image: nginx:1\n    foo: 1", "foo"],
    ["{{{", "YAML"],
  ])("rejects %j", (yaml, msg) => {
    expect(() => parseStack(yaml)).toThrow(StackError);
    expect(() => parseStack(yaml)).toThrow(msg);
  });

  it("converts docker-compose services, turning database images into managed databases", () => {
    const r = stackFromCompose(`services:
  web:
    image: ghcr.io/acme/web:1.2
    ports: ["8080:3000"]
    volumes: ["data:/app/data"]
    environment:
      DATABASE_URL: postgres://u:p@db:5432/app
      MODE: prod
  db:
    image: postgres:16-alpine
  cache:
    image: redis:7.4
`);
    const p = parseStack(r.yaml);
    expect(p.databases).toEqual([{ id: "db", engine: "postgres", version: "16", planId: "db-micro" }, { id: "cache", engine: "redis", version: "7.4", planId: "db-micro" }]);
    expect(p.apps[0]).toMatchObject({ image: "ghcr.io/acme/web:1.2", port: 3000, disk: { sizeGb: 5, mount: "/app/data" } });
    expect(p.apps[0].env).toContainEqual({ key: "DATABASE_URL", db: "db", field: "url" });
    expect(r.notes.length).toBe(2);
  });
});

describe("package mirrors", () => {
  it("covers distros, registries and package managers with copy-ready snippets", () => {
    const ids = new Set(MIRROR_ECOSYSTEMS.map((e) => e.id));
    for (const id of ["ubuntu", "debian", "fedora", "centos", "opensuse", "rocky", "alpine", "arch", "manjaro", "almalinux", "docker", "ghcr", "quay", "k8s", "mcr", "npm", "pypi", "composer", "go", "nuget", "maven", "rubygems", "crates"]) expect(ids.has(id), id).toBe(true);
    expect(new Set(MIRROR_ECOSYSTEMS.map((e) => e.repo)).size).toBe(MIRROR_ECOSYSTEMS.length);
    for (const e of MIRROR_ECOSYSTEMS) {
      expect(MIRROR_GROUPS.map((g) => g.id)).toContain(e.group);
      const s = e.snippet("https://m.test");
      expect(s.code, e.id).toContain("m.test");
      expect(s.code).not.toContain("undefined");
    }
  });
  it("setup script handles the RPM and pacman families too", () => {
    const s = mirrorSetupScript("https://m.test", "https://site.test");
    for (const id of ["fedora", "rocky", "almalinux", "arch", "opensuse"]) expect(s).toContain(id);
  });
});
