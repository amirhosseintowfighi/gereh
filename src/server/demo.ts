/* Demo mode: the ONE switch between a demo/staging install and production.
   - Demo mode is on only when asked for explicitly: DEMO=1 (or the older SEED_DEMO=1 / NEXT_PUBLIC_DEMO=1),
     and in the test suite (NODE_ENV=test). DEMO=0 always wins, so a test can run as production.
   - Only in demo mode: the demo seed, the simulators that stand in for missing integrations, and any
     other synthetic data. Production (anything else) shows only real records and real measurements;
     an integration without credentials answers with a clear "not configured" error instead of a simulator. */
import { AppError } from "./util";

export function demoMode(): boolean {
  const f = (process.env.DEMO ?? "").trim();
  if (f === "1") return true;
  if (f === "0") return false;
  if (process.env.SEED_DEMO === "1" || process.env.NEXT_PUBLIC_DEMO === "1") return true;
  return process.env.NODE_ENV === "test";
}

/** members that are plain values or synchronous in the driver contracts (everything else is async) */
const SYNC = new Set(["presign", "publicUrl"]);

/** stands in for an integration whose credentials are missing outside demo mode: every call fails with
    `what` (Persian, shown to the user) and nothing is invented. `name` reads "unconfigured". */
export function unconfigured<T extends object>(what: string): T {
  const err = () => new AppError(what + " هنوز روی این سرور تنظیم نشده است؛ مدیر سایت باید اتصال آن را برقرار کند.", 503);
  return new Proxy({} as T, {
    get(_t, p) {
      if (p === "name") return "unconfigured";
      if (typeof p !== "string" || p === "then" || p === "toJSON") return undefined;
      if (SYNC.has(p)) return () => { throw err(); };
      return () => Promise.reject(err());
    },
  });
}
