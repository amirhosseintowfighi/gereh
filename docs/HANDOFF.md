# گره (Gereh) — Frontend Handoff for Backend Implementation

This document goes with `gereh.html`, a complete clickable prototype: the public site, the user panel and the admin panel. The prototype runs entirely in the browser on mock data. Your job is to build the real backend and connect the UI to it.

## 1. What the prototype is

The prototype is a single HTML file. Its parts:

- React 18 (UMD) with `htm` tagged templates. The syntax is JSX-like, so no build step is needed.
- Tailwind (play CDN).
- Lucide icons, inlined as SVG.
- RTL layout, with all UI text in Persian.
- The font is Vazirmatn. Terminal-style text uses Geist Mono.
- Routing is hash-based (`#/panel/servers/srv-1042`).

All state lives in one in-memory `DB` object. Every change goes through an async `api.*` method. **That `api` object is the seam.** Replace each method body with a real HTTP call, keep the signatures, and the UI keeps working.

### Recommended first step

Port the prototype to a proper project before adding the backend:

1. Port it to **Vite + React + TypeScript + React Router + Tailwind**, keeping the visual design identical.
2. Turn every `function Xxx()` component into its own file.
3. Map the hash routes to real routes.
4. Move `api` into `src/api/*.ts` using fetch or axios.
5. Use TanStack Query for caching and invalidation, in place of the global `DB` and `useDB()`.

Suggested backend: **NestJS or FastAPI**, plus PostgreSQL, Redis (sessions, OTP, rate limits) and a job queue for provisioning (BullMQ or Celery).

## 2. Routes

| Route | Screen |
|---|---|
| `home`, `vps`, `hosting`, `domains`, `about`, `contact`, `terms` | Public site |
| `auth` | Login (password and OTP), register, forgot password |
| `panel` | User dashboard |
| `panel/servers`, `panel/servers/:id` | Server list. Server detail has tabs: overview, traffic, VNC console, access and apps (hostname, root password, control panel), network, firewall, backups, boot/ISO/rescue, rebuild, resize, task log, settings |
| `panel/hosting`, `panel/hosting/:id` | Hosting accounts |
| `panel/domains`, `panel/domains/:id` | Domains. Detail has DNS records, nameservers, lock/privacy/auto-renew, EPP code, renewal |
| `panel/billing` | Invoices, wallet top-up, transactions |
| `panel/tickets`, `panel/tickets/:id` | Support tickets |
| `panel/keys` | SSH keys and API tokens |
| `panel/account` | Profile, password, 2FA, sessions, notification preferences, KYC |
| `admin` | Admin dashboard |
| `admin/users` | Users. The detail drawer has suspend, KYC approve, balance adjust and impersonate |
| `admin/services` | All servers, hosting and domains |
| `admin/billing` | Invoices: mark paid, refund, manual invoice, reminder |
| `admin/tickets`, `admin/tickets/:id` | Ticket queue. Assign, status, priority, department, canned replies |
| `admin/products` | Plan and TLD pricing editor |
| `admin/infra` | Data centers, hypervisor nodes, maintenance mode |
| `admin/virtualizor` | Virtualizor connection, sync, plan → plid mapping, OS templates, policies, sync log |
| `admin/coupons` | Discount codes |
| `admin/announcements` | Banners shown on user dashboards |
| `admin/audit` | Admin audit log |
| `admin/settings` | General settings, tax and payment gateways, SMS/SMTP, staff and roles |

**Guards:** `panel/*` requires a session. `admin/*` requires `role === 'admin'`.

## 3. Entities (from `seed()`)

- `User` — `{ id, name, email, phone, company, balance, status: active|pending|suspended, kyc: verified|pending|none, joined, role }`
- `Server` — `{ id, userId, name, plan, cpu, ram, disk, loc, os, ip, ipv6, rdns, status: running|stopped|suspended, price, backups, firewall[], snapshots[], backupsList[] }`
- `FirewallRule` — `{ id, proto, port, source, action: allow|deny, note }`
- `Hosting` — `{ id, userId, domain, plan, diskUsed, diskTotal, bwUsed, bwTotal, emails, dbs, status, expires, price, panel, server }`
- `Domain` — `{ id, userId, name, registered, expires, autoRenew, privacy, locked, status, ns[], dns[], authCode }`
- `DnsRecord` — `{ id, type, name, value, ttl, priority? }`
- `Invoice` — `{ id, userId, date, due, status: paid|unpaid|overdue|refunded, items: [{desc, amount}] }`. Tax comes from `settings.tax`.
- `Transaction` — `{ id, userId, date, type: topup|payment|refund, amount, method, desc }`
- `Ticket` — `{ id, userId, subject, dept, priority, status: open|answered|customer-reply|closed, service, assignee, messages: [{from: user|staff, name, at, text}] }`
- Also: `SshKey`, `ApiToken`, `Session`, `Notification`, `Activity`, `Node`, `Coupon`, `Announcement`, `AuditEntry`, `Staff`, `Settings`, and the plan/TLD catalogs (`VPS`, `HOSTING`, `TLDS`).

All amounts are in **Toman** (integers). Dates are shown in the Jalali calendar. Store them as UTC timestamps and format on the client with `toLocaleDateString('fa-IR')`.

## 4. API contract (one endpoint per `api.*` method)

```
POST   /auth/login                 {id, password}         -> session
POST   /auth/otp/send              {phone}
POST   /auth/otp/verify            {phone, code}          -> session
POST   /auth/register              {name,email,phone,password}
POST   /auth/forgot                {email}
POST   /auth/logout

GET    /servers                    GET /servers/:id
POST   /servers/:id/power          {action: start|stop|reboot}
PATCH  /servers/:id                {name?, rdns?}
POST   /servers/:id/resize         {planId}
POST   /servers/:id/rebuild        {os}
DELETE /servers/:id
POST   /servers/:id/backups/toggle
POST   /servers/:id/snapshots      {name?}     DELETE /servers/:id/snapshots/:sid
POST   /servers/:id/restore        {backupId | snapshotId}
POST   /servers/:id/firewall       {rule}      DELETE /servers/:id/firewall/:rid
WS     /servers/:id/console        (noVNC / xterm.js)
GET    /servers/:id/metrics        (cpu, ram, net, iops time series)

GET    /hosting  GET /hosting/:id  POST /hosting/:id/reset-password  POST /hosting/:id/sso

GET    /domains/check?name=        (availability across TLDs)
GET    /domains  GET /domains/:id
POST   /domains/:id/dns            PUT /domains/:id/dns/:rid   DELETE /domains/:id/dns/:rid
PUT    /domains/:id/nameservers    {ns[]}
PATCH  /domains/:id                {autoRenew?, privacy?, locked?}
GET    /domains/:id/auth-code
POST   /domains/:id/renew          {years}  -> invoice

GET    /invoices  GET /invoices/:id
POST   /invoices/:id/pay           {method: wallet|gateway}  -> gateway redirect URL when gateway
POST   /wallet/topup               {amount} -> gateway redirect URL
GET    /transactions
POST   /checkout                   {items[], coupon?} -> invoice

GET/POST /tickets   GET /tickets/:id   POST /tickets/:id/replies   PATCH /tickets/:id
GET/POST/DELETE /account/ssh-keys    GET/POST/DELETE /account/api-tokens
PATCH  /account/profile   POST /account/password   POST /account/2fa/(enable|disable)
GET/DELETE /account/sessions   PUT /account/notifications   POST /account/kyc (multipart)
GET    /notifications   POST /notifications/read-all   GET /activity
GET    /announcements

/admin/users (list, get, patch, create, POST :id/balance, POST :id/impersonate)
/admin/services, /admin/invoices (mark-paid, refund, create), /admin/tickets
/admin/plans, /admin/tlds, /admin/nodes (toggle maintenance, create)
/admin/coupons, /admin/announcements, /admin/audit, /admin/settings, /admin/staff
```

Every admin mutation must write an audit entry. The prototype already does this in `logAudit()`.

## 5. Integrations to implement

- **Virtualization: Virtualizor.** The full spec is in **`VIRTUALIZOR.md`**: architecture, provisioning flow, feature-to-API map, monitoring jobs and a TypeScript client skeleton.
  - All server actions go through the Admin API and the Enduser API, using admin credentials with `svs=vpsid`.
  - Traffic and usage are collected by background jobs. The UI reads history from the DB and live status from Redis.
- **Hosting:** cPanel/WHM API (account create, suspend, SSO login, password reset).
- **Domains:**
  - IRNIC for `.ir` domains.
  - A registrar API (for example ResellerClub or OpenSRS) for international TLDs.
  - PowerDNS for the DNS zones served by `ns1/ns2.gereh.cloud`.
- **Payments:**
  - Zarinpal and IDPay, using the request → redirect → verify-callback flow.
  - Credit the wallet or mark the invoice paid only after verification succeeds.
- **SMS** (Kavenegar) for OTP and alerts. **SMTP** for email.
- **2FA:** TOTP (RFC 6238). Generate a real secret and QR code in place of the decorative one.

## 6. Demo-only things to remove

- The "ورود سریع بدون رمز" demo buttons on the auth page (`api.auth.demo`).
- The `window.confirm` calls. Replace them with the in-app `Modal` for destructive actions.
- The fake console responses (`FakeConsole`). Replace them with a real VNC/serial console.
- `LiveMetric` and `LiveSpark` random data. Replace them with real metrics.
- Hard-coded user `u1`. Use the session user everywhere.

## 7. Brand and credit (keep as is)

- The footer must keep the line **«طراحی و توسعه با ❤️ توسط ویرگول»**, with «ویرگول» linking to https://virgule.studio.
- The footer, the auth screen, the panel sidebar and the About page state that Gereh is part of, and powered by, Virgule. Keep these.
- **Design tokens:**
  - Colors: background `#04050b`, ice accent `#9cc9ff`, silver headline gradient.
  - Type: Vazirmatn for text, Geist Mono for terminal and technical text.
  - Glass panels: `bg-white/[0.055] backdrop-blur-xl border-white/[0.11]` with an inset top highlight.
  - Primary buttons are solid white with dark text.
  - Brand pattern: the girih star-and-lattice tessellation (`GirihField`, گره‌چینی). It sits faint behind the hero, page headers, auth screen and CTA, and an ice-blue layer is revealed around the pointer.
  - Motion: `cubic-bezier(.16,1,.3,1)`, 200–350 ms.
