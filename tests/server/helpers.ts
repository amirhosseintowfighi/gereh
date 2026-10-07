import { registry } from "@/server/rpc";
import { closeDb } from "@/server/db/client";
import { context, resetBoot } from "@/server/ctx";
import { outbox } from "@/server/messaging";
import { DEMO_PASSWORD } from "@/server/seed";

export const jar = (globalThis as unknown as { __testJar: Map<string, string> }).__testJar;

/** call an RPC method the way the HTTP route does (argument validation included) */
export async function call<T = unknown>(name: string, ...args: unknown[]): Promise<T> {
  const m = registry[name];
  if (!m) throw new Error("no such method " + name);
  const parsed = m.args.parse(args);
  return (await m.run(await context(), parsed)) as T;
}
/** expect a user-facing failure; returns its message */
export async function fails(name: string, ...args: unknown[]) {
  try { await call(name, ...args); } catch (e) { return (e as Error).message; }
  throw new Error(name + " was expected to fail");
}

export async function fresh() {
  await closeDb();
  resetBoot();
  jar.clear();
  outbox.length = 0;
}
export const login = async (email: string) => { jar.clear(); return call("auth.login", email, DEMO_PASSWORD); };
export const asUser = () => login("demo@gereh.net");
export const asAdmin = () => login("admin@gereh.net");
export const db = async () => (await context()).db;
