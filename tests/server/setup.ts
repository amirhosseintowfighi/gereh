import { vi } from "vitest";

/* next/headers outside a request: an in-memory cookie jar + headers the tests can set */
const jar = new Map<string, string>();
export const testHeaders = new Map<string, string>([["user-agent", "Mozilla/5.0 (X11; Linux x86_64) Chrome/140"], ["x-real-ip", "203.0.113.7"]]);
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => { jar.set(n, v); },
    delete: (n: string) => { jar.delete(n); },
  }),
  headers: async () => ({ get: (n: string) => testHeaders.get(n.toLowerCase()) ?? null }),
}));
(globalThis as { __testJar?: Map<string, string> }).__testJar = jar;
(process.env as Record<string, string>).NODE_ENV ??= "test";
