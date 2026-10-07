import { describe, expect, it } from "vitest";
import { ComposeError, parseCompose } from "@/server/paas/compose";

describe("compose parser", () => {
  it("reads build/image services, ports, env, commands; first service with ports is public", () => {
    const { services, warnings } = parseCompose(`
services:
  web:
    build: ./web
    ports: ["8080:3000"]
    environment:
      - REDIS_URL=redis://cache:6379
    depends_on: [cache]
  worker:
    build: { context: ./web, dockerfile: Dockerfile.worker }
    command: ["node", "worker.js", "--queue=default"]
  cache:
    image: redis:7-alpine
    volumes: ["cache:/data"]
volumes: { cache: {} }
`);
    expect(services).toEqual([
      { name: "web", build: { context: "web" }, port: 3000, env: { REDIS_URL: "redis://cache:6379" }, public: true },
      { name: "worker", build: { context: "web", dockerfile: "Dockerfile.worker" }, command: "node worker.js --queue=default", env: {}, public: false },
      { name: "cache", image: "redis:7-alpine", env: {}, public: false },
    ]);
    expect(warnings.join()).toContain("cache: volumes");
  });

  it("the gereh.public label picks the public service", () => {
    const { services } = parseCompose(`
services:
  api: { image: ghcr.io/acme/api, ports: ["9000"] }
  front: { image: nginx:alpine, ports: [{ target: 80, published: 8080 }], labels: { gereh.public: "true" } }
`);
    expect(services.find((s) => s.public)!.name).toBe("front");
    expect(services.find((s) => s.public)!.port).toBe(80);
  });

  it("rejects what cannot run", () => {
    const bad = (y: string) => { try { parseCompose(y); return ""; } catch (e) { expect(e).toBeInstanceOf(ComposeError); return (e as Error).message; } };
    expect(bad("version: '3'")).toContain("services");
    expect(bad("services:\n  web: { build: ../outside, ports: [80] }")).toContain("داخل پروژه");
    expect(bad("services:\n  web: { build: /etc, ports: [80] }")).toContain("داخل پروژه");
    expect(bad("services:\n  web: { environment: [A=1] }")).toContain("نه build");
    expect(bad("services:\n  worker: { image: busybox }")).toContain("ports");
    expect(bad("services:\n  Web_App_With_A_Very_Long_Name: { image: x, ports: [80] }")).toContain("۲۰");
    expect(bad("services: [unclosed")).toContain("خوانا");
  });
});
