/* Gereh Apps outbound proxy on the server: the per-app row, the platform's shared proxy (kv "paas_egress",
   else PAAS_EGRESS_PROXY / PAAS_EGRESS_NO_PROXY) and the env an app gets from them. Proxy URLs may carry
   credentials: they are sealed at rest, go only into the app's env Secret and are never logged. */
import "server-only";
import { eq } from "drizzle-orm";
import { INTERNAL_NO_PROXY, parseNoProxy, PROXY_RE, proxyEnv, type EgressMode } from "@/lib/paas-egress";
import { aiEndpoint } from "../ai/state";
import type { DB, Tx } from "../db/client";
import { kv, paasEgress } from "../db/schema";
import { open, seal } from "../secrets";

const KV_KEY = "paas_egress";
type Stored = { proxyEnc?: string; noProxy?: string[] };

/** the platform proxy: the admin's value, else the environment */
export async function platformEgress(db: DB | Tx): Promise<{ url: string; noProxy: string[]; source: "admin" | "env" | "" }> {
  const [row] = await db.select().from(kv).where(eq(kv.key, KV_KEY));
  const v = (row?.value as Stored | undefined) ?? {};
  const url = v.proxyEnc ? open(v.proxyEnc) ?? "" : "";
  if (url) return { url, noProxy: v.noProxy ?? [], source: "admin" };
  const envUrl = (process.env.PAAS_EGRESS_PROXY || "").trim();
  if (envUrl && PROXY_RE.test(envUrl)) return { url: envUrl, noProxy: parseNoProxy(process.env.PAAS_EGRESS_NO_PROXY || ""), source: "env" };
  return { url: "", noProxy: v.noProxy ?? [], source: "" };
}
export async function savePlatformEgress(db: DB | Tx, url: string | null, noProxy: string[]) {
  const [row] = await db.select().from(kv).where(eq(kv.key, KV_KEY));
  const cur = (row?.value as Stored | undefined) ?? {};
  // null keeps the stored URL, "" clears it
  const value: Stored = { proxyEnc: url === null ? cur.proxyEnc ?? "" : url ? seal(url) : "", noProxy };
  await db.insert(kv).values({ key: KV_KEY, value }).onConflictDoUpdate({ target: kv.key, set: { value } });
}

export type EgressRow = typeof paasEgress.$inferSelect;
export async function loadEgress(db: DB | Tx, appId: string): Promise<EgressRow | null> {
  const [r] = await db.select().from(paasEgress).where(eq(paasEgress.appId, appId));
  return r ?? null;
}
export async function saveEgress(db: DB | Tx, appId: string, p: { mode: EgressMode; url?: string | null; noProxy?: string[]; extraKeys?: string[] }) {
  const set: Partial<typeof paasEgress.$inferInsert> = { mode: p.mode, updatedAt: new Date() };
  if (p.url !== undefined && p.url !== null) set.proxyEnc = p.url ? seal(p.url) : "";
  if (p.noProxy) set.noProxy = p.noProxy;
  if (p.extraKeys) set.extraKeys = p.extraKeys;
  await db.insert(paasEgress).values({ appId, ...set }).onConflictDoUpdate({ target: paasEgress.appId, set });
}

const hostOf = (url: string) => { try { return new URL(url).hostname; } catch { return ""; } };
/** the proxy env of one app (empty when off, or the platform proxy is not configured); `internal` are
    hosts the app reaches inside Iran or the cluster (its databases, the AI gateway, the apps domain) */
export async function egressEnv(db: DB | Tx, appId: string, internal: string[]): Promise<Record<string, string>> {
  const row = await loadEgress(db, appId);
  if (!row || row.mode === "off") return {};
  let url = "", base: string[] = [];
  if (row.mode === "custom") url = open(row.proxyEnc) ?? "";
  else { const p = await platformEgress(db); url = p.url; base = p.noProxy; }
  if (!url) return {};
  const ai = hostOf(aiEndpoint());
  const noProxy = [...new Set([...INTERNAL_NO_PROXY, ...internal.filter(Boolean), ...(ai ? [ai] : []), ...base, ...row.noProxy])];
  return proxyEnv(url, noProxy, row.extraKeys);
}
