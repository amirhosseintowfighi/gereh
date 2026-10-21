/* Gereh Apps outbound proxy (per app, or the platform's shared one) and the n8n task-runner sidecar.
   Shared by the panel and the server; no server imports here.

   The cluster cannot reach some foreign APIs (Telegram's Bot API among them). An app can send its
   outbound traffic through an HTTP(S) or SOCKS5 proxy: the URL is injected as HTTP_PROXY, HTTPS_PROXY
   and ALL_PROXY (both cases) with a NO_PROXY list that keeps cluster-internal traffic direct.
   Python requests/httpx and curl honour these; Node's built-in fetch only with NODE_USE_ENV_PROXY=1
   (Node 24+), which is set too. */

export type EgressMode = "off" | "custom" | "platform";
export const PROXY_RE = /^(https?|socks5h?):\/\/([^\s:@/]+(:[^\s@/]*)?@)?[a-z0-9.-]+(:\d{1,5})?\/?$/i;
/** cluster-internal ranges and names that never go through the proxy */
export const INTERNAL_NO_PROXY = ["localhost", "127.0.0.1", "::1", ".svc", ".svc.cluster.local", ".cluster.local", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"];
export const NO_PROXY_MAX = 40;

export function proxyError(url: string) {
  if (url.length > 500 || !PROXY_RE.test(url)) return "نشانی پروکسی معتبر نیست؛ مثل http://user:pass@1.2.3.4:3128 یا socks5://1.2.3.4:1080";
  const port = /:(\d+)\/?$/.exec(url.replace(/^[a-z0-9]+:\/\//i, ""));
  if (port && (Number(port[1]) < 1 || Number(port[1]) > 65535)) return "پورت پروکسی معتبر نیست.";
  return null;
}
/** comma/space/newline separated hosts, .domains, IPs or CIDRs */
export function parseNoProxy(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
}
export function noProxyError(list: string[]) {
  if (list.length > NO_PROXY_MAX) return "حداکثر " + NO_PROXY_MAX.toLocaleString("fa-IR") + " مورد در فهرست بدون پروکسی.";
  for (const s of list) if (!/^(\*?\.?[a-z0-9-]+(\.[a-z0-9-]+)*|[0-9a-f:.]+(\/\d{1,3})?)$/.test(s) || s.length > 253) return "«" + s + "» نام میزبان، IP یا بازه معتبری نیست.";
  return null;
}
/** the URL without its credentials, for display */
export const maskProxy = (url: string) => url.replace(/^([a-z0-9]+:\/\/)[^@/]*@/i, "$1***@");

/** env for a proxy URL; `noProxy` is the complete list, `extra` names also receive the URL (e.g. TELEGRAM_PROXY) */
export function proxyEnv(url: string, noProxy: string[], extra: string[] = []): Record<string, string> {
  const no = noProxy.join(",");
  const out: Record<string, string> = {
    HTTP_PROXY: url, HTTPS_PROXY: url, ALL_PROXY: url, http_proxy: url, https_proxy: url, all_proxy: url,
    NO_PROXY: no, no_proxy: no,
  };
  // Node's built-in env proxy understands HTTP(S) proxies only
  if (/^https?:/i.test(url)) out.NODE_USE_ENV_PROXY = "1";
  for (const k of extra) out[k] = url;
  return out;
}

/* ---------- n8n task runners ---------- */
/** n8n 1.111+ and 2.x run the Code node in task runners; Python (and the hardened JS runner) need the
    n8nio/runners image of the same version beside n8n in "external" mode. Only exact x.y.z tags of the
    official image qualify, so the two images always match. */
export function n8nRunners(image: string): { image: string; version: string; major: number } | null {
  const m = /^(?:docker\.io\/|docker\.n8n\.io\/)?n8nio\/n8n:(\d+)\.(\d+)\.(\d+)$/.exec(image);
  if (!m) return null;
  const [maj, min] = [Number(m[1]), Number(m[2])];
  if (maj < 1 || (maj === 1 && min < 111)) return null;
  const version = m[1] + "." + m[2] + "." + m[3];
  return { image: "n8nio/runners:" + version, version, major: maj };
}
/** memory (MB) the runners sidecar takes out of the plan; 0 = plan too small, no sidecar */
export const runnersMemory = (ramMb: number) => (ramMb < 512 ? 0 : Math.min(512, Math.max(128, Math.round(ramMb / 4 / 64) * 64)));
