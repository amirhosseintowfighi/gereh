# Gereh × Virtualizor — Integration Spec

This document goes with `HANDOFF.md`. Gereh's server infrastructure runs on **Virtualizor**. The website and panels are the only customer-facing UI. Every server action a user takes in the Gereh panel must run on Virtualizor through its API, and every number the UI shows must come from Virtualizor: status, usage, bandwidth, VNC and task logs.

> **Before writing code:** the official PHP SDKs live on the Virtualizor master at `/usr/local/virtualizor/sdk/admin.php` and `/usr/local/virtualizor/sdk/enduser.php`. Port the request signing and the exact parameter names from them. Endpoints marked **(verify)** below are standard Virtualizor features whose exact `act`/params must be confirmed against the installed version's docs or SDK (https://www.virtualizor.com/docs/admin-api/ and https://www.virtualizor.com/docs/enduser-api/).

---

## 1. Architecture

```
Browser (Gereh panel) ──► Gereh API (your backend) ──► Virtualizor Admin API   :4085
                               │                    └─► Virtualizor Enduser API :4083  (called WITH ADMIN creds, svs=vpsid)
                               ├─ PostgreSQL (users, orders, servers↔vpsid, plan map, usage history)
                               ├─ Redis (locks, rate limits, cached live stats)
                               └─ Worker/queue (provisioning, sync, usage collection, suspensions)
```

**Rules:**

1. **The browser never talks to Virtualizor.** The API key and password live only in backend env/secrets (`VIRTUALIZOR_HOST`, `VIRTUALIZOR_PORT=4085`, `VIRTUALIZOR_KEY`, `VIRTUALIZOR_PASS`).
2. **One set of admin credentials.** Use the Admin API for provisioning and administration.
   - For per-VPS "enduser" features (rescue, hostname, VNC, monitor, OS reinstall and so on), call the **Enduser API on port 4083 with the admin key**, passing `svs=<vpsid>`.
   - The SDK supports this through the `is_admin` flag: `new Virtualizor_Enduser_API($ip, $key, $pass, 4083, 1)`.
   - Users therefore never need their own Virtualizor API keys.
3. **Ownership check on every call.** Resolve `server.id → vpsid` from your DB and confirm `server.userId === session.userId` before calling Virtualizor. Never accept a raw `vpsid` from the client.
4. **Allow-list the Gereh backend IP** in Virtualizor: *Master Settings → Security → "Allowed IP list to restrict API operations"*.
5. **Hide the Virtualizor enduser panel.** Set `admin_managed=1` on VPSs (Manage VPS API) so customers can only manage servers from the Gereh panel. This is a toggle in Admin › اتصال Virtualizor › سیاست‌ها.
6. **Cache and debounce reads.** Live status lives in Redis with a ~30 s TTL. Never call Virtualizor on every page render.

---

## 2. Data model additions

| Table | Fields |
|---|---|
| `users` | `virt_uid` (int, nullable). The Virtualizor user created via `adduser` on the first order. |
| `servers` | `vpsid` (int, unique), `virt_server_id` (serid), `hostname`, `plid`, `osid`, `bw_limit_gb`, `rescue`, `boot`, `iso`, `last_synced_at` |
| `plan_map` | `gereh_plan_id`, `virt_plid`, `server_group` (location → Virtualizor server group) |
| `os_templates` | `osid`, `name`, `distro`, `enabled` (synced from Virtualizor; admin chooses which are shown) |
| `isos` | `filename`, `enabled` |
| `usage_daily` | `server_id`, `date`, `bw_in_mb`, `bw_out_mb`, `cpu_avg`, `ram_avg`, `disk_used_mb` |
| `virt_tasks` | `server_id`, `virt_actid?`, `action`, `status`, `progress`, `created_at` |
| `virt_sync_log` | `kind`, `result`, `detail`, `created_at` |

---

## 3. Provisioning flow (order → running VPS)

1. **Invoice paid.** Enqueue `provision_server(order_id)`. Make the job idempotent: lock on `order_id`, and skip if `servers.vpsid` is already set.
2. **Ensure a Virtualizor user.** If `users.virt_uid` is null, call Admin API `act=adduser` (normal user, `priority=0`) with the email and a random password, then store the returned id.
3. **Create the VPS.** Call Admin API `act=addvs` with `addvps=1`. Params:
   - `uid`, `plid` (from `plan_map`), `osid`, `hostname`, `rootpass`.
   - Server or server group: the least-loaded server in the group mapped from the chosen location.
   - `num_ips`/`ips` per the docs.
   - Store `vpsinfo.vpsid` from the response.
4. **Wait for the build.** Poll Admin API `act=vs&vs_status[]=vpsid` until `status=1`, with a timeout. Push progress to the user over SSE or WebSocket; the hero terminal and the "لاگ عملیات" tab show the intended UX.
5. **Notify the user.** Send the IP, hostname and root password (once, by email or panel) and log activity.
6. **On failure:** mark the order as `provision_failed`, alert staff, and do **not** charge twice.

**Lifecycle hooks:**

| Event | Virtualizor call |
|---|---|
| Unpaid, 7 days past due | Admin `act=vs&suspend=vpsid` **(verify)** |
| Paid again | Admin `act=vs&unsuspend=vpsid` **(verify)** |
| Unpaid, 14 days after suspension | Admin `act=vs&delete=vpsid` **(verify)** |
| Resize (ارتقا) | Admin **Manage VPS** (`act=managevps`, `vpsid`, `plid` or `cores`/`ram`/`space`, then `editvps=1`), and bill the prorated difference |

---

## 4. Feature map — Gereh UI → Virtualizor

The **E** prefix means the Enduser API on port 4083, called with admin credentials and `svs=vpsid`. The **A** prefix means the Admin API on port 4085.

| Gereh UI (panel/servers/:id) | Call | Notes |
|---|---|---|
| List servers / header info | A `act=vs` (filter by `uid`) or E `act=listvs` | `listvs` returns hostname, `os_name`, ram, space, `vnc`, `rescue`, `boot`, `iso` per VPS |
| Status + live usage (overview cards) | A `act=vs&vs_status[]=…` | Returns `status` (0 off, 1 on, 2 suspended), `used_cpu`, `used_ram`, `used_disk`, `net_in`/`net_out`, `io_read`/`io_write`, `used_bandwidth`, `bandwidth` |
| Start / Stop / Restart / Power-off | E `act=start` / `stop` / `restart` / `poweroff` (`do=1`) | Admin-side equivalents also exist |
| CPU / RAM / disk monitor | E `act=monitor&svs=…` (`show=YYYYMM` for monthly) | Returns cpu/ram/disk limit, used and percent |
| Traffic tab (daily in/out, monthly quota) | E `act=bandwidth&svs=…&show=YYYYMM`, or A `act=vps_stats` (`vpsid`) | Daily usage for days 1–31, split into in/out, in MB |
| Console VNC | E `act=vnc&svs=…` → host, port, password; embed **noVNC** behind a websocket proxy (websockify) on your side | KVM/Xen only. Never expose the raw VNC port to the browser without a proxy and a short-lived token |
| Change VNC password | E `act=vncpass` | |
| Hostname | E `act=hostname` (`newhostname`) | |
| Root password | E `act=changepassword` | Usually requires a reboot. The UI confirms before running it |
| Reinstall OS | E `act=ostemplate` to list; reinstall with `newosid` + `newpass` | Show only templates with `os_templates.enabled = true` |
| Install control panel / app | E `act=controlpanel` (for example `cpanel`, `plesk`, `webuzo`) | |
| Rescue mode | E `act=rescue`: enable with `enablerescue=1`, `password`, `conf_password`; disable with `disablerescue=1` | |
| Boot order | Manage VPS `boot` (for example `cda`, `dca`) **(verify)** | |
| Mount / eject ISO | Manage VPS `iso` / `sec_iso` **(verify)** | |
| Task log (لاگ عملیات) | E/A tasks API **(verify)**; also store your own `virt_tasks` | |
| Network: IPs | from `listvs`/`vpsmanage` | |
| Network: rDNS | Virtualizor PowerDNS rDNS feature **(verify)**, or your own PowerDNS | |
| Network: buy extra IPv4 | Manage VPS `ips` | Add the cost to an invoice |
| Backups | Virtualizor backup plans (admin) + enduser backup/restore **(verify)** | The "بکاپ خودکار" toggle maps to assigning/removing a backup plan |
| Snapshots | **(verify)** support depends on storage type. Hide the tab if unsupported | |
| Firewall | Virtualizor's firewall is server-level. Per-VPS rules may not exist in your version **(verify)** | If unsupported, implement on the hypervisor with nftables/iptables via your agent, or hide the tab |
| SSH keys | E SSH keys API (list/add/generate) **(verify)**; pass keys on `addvs` | |
| Delete server | A delete VPS **(verify)** | Run after the type-to-confirm step in the UI |
| Fallback for anything not yet built | E `act=sso&svs=…` returns a one-time login URL to the Virtualizor enduser panel for that VPS | Use only while a feature is missing. Disable once `admin_managed=1` is enforced |

**Admin panel (Admin › اتصال Virtualizor):**

| Gereh admin action | Call |
|---|---|
| Test connection | Any cheap Admin call (for example `act=servers`) with timeout + TLS check |
| Sync servers/nodes | A `act=servers` (+ server stats) → `admin/infra` table |
| Sync plans | A `act=plans` → admin maps them in "نگاشت پلن‌ها" |
| Sync OS templates | A `act=ostemplates` → `os_templates` (admin toggles visibility) |
| Sync VPS + reconciliation (nightly) | A `act=vs` (paged). Flag VPSs that exist in Virtualizor without a Gereh order and vice versa → `virt_sync_log` (warn) |
| Bandwidth overview | A `act=bandwidth&show=YYYYMM` (server level), `act=vps_stats` (per VPS) |
| Suspend / unsuspend / terminate | see lifecycle hooks above |
| Admin SSO to Virtualizor | A `act=sso` (one-time admin login URL) |

---

## 5. Monitoring and traffic collection

| Job | Interval | Call | Writes |
|---|---|---|---|
| `status_poll` | 60 s | A `vs_status[]` in batches of ~50 vpsids | Redis `vps:{id}:live` (TTL 90 s) for overview cards and the server list |
| `usage_collect` | 5 min | A `vps_stats` or E `monitor` / `bandwidth` | upsert `usage_daily`; recompute monthly usage |
| `quota_enforce` | 5 min | — | at 80% send an email/SMS warning; at 100% apply the policy. Either throttle (`network_speed` via Manage VPS) or suspend network (`band_suspend`). Then create an invoice for extra traffic |
| `reconcile` | nightly | A `vs`, `servers`, `plans`, `ostemplates` | `virt_sync_log`, admin alerts |

The panel's charts read from `usage_daily` (history) plus Redis (live). They never read Virtualizor directly.

---

## 6. Backend client skeleton (TypeScript)

```ts
// src/infra/virtualizor.ts — port signing + param names from /usr/local/virtualizor/sdk/*.php
import { Agent } from 'undici';

type Dict = Record<string, string | number | (string | number)[] | undefined>;

export class Virtualizor {
  constructor(
    private host = process.env.VIRTUALIZOR_HOST!,
    private key = process.env.VIRTUALIZOR_KEY!,
    private pass = process.env.VIRTUALIZOR_PASS!,
    private adminPort = 4085,
    private enduserPort = 4083,
    private dispatcher = new Agent({ connect: { rejectUnauthorized: process.env.VIRTUALIZOR_TLS_STRICT !== '0' } }),
  ) {}

  /** Signed API key exactly as the official SDK builds it (see admin.php -> make_apikey / call). */
  private apikey(): string { throw new Error('TODO: port from SDK'); }

  private async call(port: number, act: string, query: Dict = {}, body?: Dict) {
    const qs = new URLSearchParams({ act, api: 'json', apikey: this.apikey(), ...(port === this.enduserPort ? { adminapikey: '' } : {}) } as any);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) Array.isArray(v) ? v.forEach(x => qs.append(`${k}[]`, String(x))) : qs.set(k, String(v));
    const res = await fetch(`https://${this.host}:${port}/index.php?${qs}`, {
      method: body ? 'POST' : 'GET',
      body: body ? new URLSearchParams(body as any) : undefined,
      // @ts-ignore undici dispatcher
      dispatcher: this.dispatcher,
      signal: AbortSignal.timeout(20_000),
    });
    const json = await res.json();
    if (json.error && Object.keys(json.error).length) throw new VirtualizorError(json.error);
    return json;
  }
  admin(act: string, q?: Dict, b?: Dict) { return this.call(this.adminPort, act, q, b); }
  enduser(vpsid: number, act: string, q: Dict = {}, b?: Dict) { return this.call(this.enduserPort, act, { ...q, svs: vpsid }, b); }

  // ---- provisioning / admin ----
  addUser(email: string, password: string) { return this.admin('adduser', {}, { adduser: 1, priority: 0, newemail: email, newpass: password }); } // verify field names
  createVps(p: { uid: number; plid: number; osid: number; hostname: string; rootpass: string; serid?: number; num_ips?: number }) { return this.admin('addvs', {}, { addvps: 1, ...p }); }
  status(vpsids: number[]) { return this.admin('vs', { vs_status: vpsids }); }
  vpsStats(vpsid: number) { return this.admin('vps_stats', {}, { vpsid }); }
  manageVps(vpsid: number, changes: Dict) { return this.admin('managevps', {}, { vpsid, editvps: 1, ...changes }); }
  plans() { return this.admin('plans'); }
  servers() { return this.admin('servers'); }
  osTemplates() { return this.admin('ostemplates'); }

  // ---- enduser features (admin creds + svs) ----
  power(vpsid: number, action: 'start' | 'stop' | 'restart' | 'poweroff') { return this.enduser(vpsid, action, { do: 1 }); }
  monitor(vpsid: number, month?: string) { return this.enduser(vpsid, 'monitor', { show: month }); }
  bandwidth(vpsid: number, month?: string) { return this.enduser(vpsid, 'bandwidth', {}, month ? { show: month } : undefined); }
  vnc(vpsid: number) { return this.enduser(vpsid, 'vnc'); }
  vncPass(vpsid: number, pass: string) { return this.enduser(vpsid, 'vncpass', {}, { newpass: pass, conf: pass }); } // verify field names
  hostname(vpsid: number, newhostname: string) { return this.enduser(vpsid, 'hostname', {}, { newhost: newhostname, changehost: 1 }); } // verify
  rootPassword(vpsid: number, pass: string) { return this.enduser(vpsid, 'changepassword', {}, { newpass: pass, conf: pass, changepass: 1 }); } // verify
  osList(vpsid: number) { return this.enduser(vpsid, 'ostemplate'); }
  reinstall(vpsid: number, osid: number, pass: string) { return this.enduser(vpsid, 'ostemplate', {}, { newos: osid, newpass: pass, conf: pass, reinsos: 1 }); } // verify
  rescue(vpsid: number, on: boolean, pass?: string) {
    return this.enduser(vpsid, 'rescue', { do: 1 }, on ? { enablerescue: 1, password: pass, conf_password: pass } : { disablerescue: 1 });
  }
  controlPanel(vpsid: number, panel: string) { return this.enduser(vpsid, 'controlpanel', {}, { ins: panel }); } // verify
  sso(vpsid: number) { return this.enduser(vpsid, 'sso'); }
}

export class VirtualizorError extends Error { constructor(public details: unknown) { super('Virtualizor API error'); } }
```

Map each method to the existing `api.servers.*` / `api.admin.*` calls in the prototype. Their names and comments in `gereh.html` mirror the table above.

---

## 7. Mapping to the prototype

- **User panel (`panel/servers/:id`)** has these tabs, each backed by the calls in section 4: نمای کلی، ترافیک، کنسول VNC، دسترسی و اپلیکیشن، شبکه، فایروال، بکاپ و اسنپ‌شات، بوت/ISO/ریسکیو، نصب مجدد، ارتقا، لاگ عملیات، تنظیمات.
- **Admin › اتصال Virtualizor** has these tabs:
  - اتصال: credentials, test, manual sync and auto-sync.
  - نگاشت پلن‌ها: Gereh plan → `plid` + server group.
  - قالب‌های سیستم‌عامل: synced templates and their visibility.
  - سیاست‌ها: band_suspend, auto-suspend/terminate for unpaid, `admin_managed`.
  - گزارش همگام‌سازی.
- **Admin › زیرساخت** shows Virtualizor servers/nodes, filled from the servers sync.

## 8. Testing

1. Point a staging backend at a **Virtualizor test node**, never production first.
2. Write integration tests per method using a dedicated test user and `plid`. Clean up VPSs after each run.
3. Record real responses as fixtures for unit tests. Virtualizor returns a lot of extra keys, so validate only the fields you use (zod/pydantic).
4. Chaos cases to cover:
   - Virtualizor unreachable: show a stale-data banner and queue writes, with no silent failures.
   - `addvs` timeout: avoid duplicate VPSs by reconciling on `hostname` + `uid` before retrying.
   - Partial suspension.
