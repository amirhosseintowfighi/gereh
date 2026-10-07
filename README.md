# گره — Gereh Cloud

Website, customer panel, admin panel and backend for **Gereh**, a Persian (RTL) cloud-server, web-hosting and domain provider. The public site also has an English version at `/en`.

**Stack:** Next.js 16 (App Router, Turbopack, React Compiler) · React 19 · TypeScript · Tailwind CSS 4 · Drizzle ORM (PostgreSQL or embedded PGlite) · Zod · Vitest · Playwright · a Go Terraform provider

## Getting started

```bash
npm ci
npm run dev          # http://localhost:3000 — embedded in-memory database seeded with demo data
```

Demo logins use the password `Demo1234!`:

| Account | Role |
|---|---|
| `demo@gereh.cloud` | Customer with servers, hosting, domains, invoices and tickets |
| `admin@gereh.cloud` | Staff, owner role |
| `kaveh@gereh.cloud` / `shima@gereh.cloud` | Staff with the support / finance roles |

**Server install:** on a fresh Ubuntu/Debian server run `sudo bash deploy/install.sh`. It sets up Node.js, PostgreSQL, a systemd service, Nginx, SSL, the firewall and daily backups, and installs the `gereh` command for updates with automatic rollback, backups and restores. See [`deploy/README.md`](deploy/README.md).

To configure manually instead, copy `.env.example` to `.env` and set at least `DATABASE_URL`, `APP_SECRET`, `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Any integration without credentials falls back to a simulator: Virtualizor, Zarinpal/IDPay, Kavenegar SMS, SMTP, WHM/cPanel, PowerDNS and ResellerClub. Payments use a test gateway, which is disabled in production. Messages go to an in-memory outbox.

| Script | What it does |
|---|---|
| `npm run build` / `npm start` | Production build and server (the background worker starts with the server) |
| `npm run typecheck` | Generates route types (`next typegen`) and runs `tsc` |
| `npm run lint` | ESLint, including the React Compiler rules |
| `npm test` | Vitest: `unit` (happy-dom) and `server` (Node + PGlite per file) projects |
| `npm run test:e2e` | Playwright against the production build (run `npm run build` first; `CHROMIUM_PATH` for a preinstalled browser) |
| `npm run bench` | Lighthouse and HTTP load benchmark; writes `benchmarks/RESULTS.md` |
| `npm run assets` | Regenerates icons and `og.png` from `public/icon.svg` |

## Architecture

```
src/app/(site)          public pages (fa): home, vps, hosting, domains (+ /domains/[tld]), about, contact,
                        status, kb (+ articles), docs/api, blog (+ posts, tags, rss.xml), compare, legal pages
src/app/(en)/en         English public site (lang=en, dir=ltr, hreflang pairs with the Persian pages)
src/app/(auth)          /auth: password, SMS OTP, 2FA, registration, password reset
src/app/panel           customer panel: servers, hosting, domains/DNS, billing, tickets, keys/API, affiliate, account/team
src/app/admin           staff panel: users, services, billing, reports, tickets, live chat, products, infra, status,
                        Virtualizor, coupons, announcements, blog, audit, settings
src/app/api             rpc/[method], state, pay/callback, kyc, chat, admin/reports, v1 (public REST), test (e2e only)
src/server              backend (server-only): db/, rpc/, worker/, auth, providers, payments, messaging, reports …
src/lib                 code shared by client and server: catalogue/pricing, money, Jalali dates, Markdown, store
src/content             knowledge-base articles, API docs, TLD copy, English copy, demo blog posts
drizzle/                SQL migrations (applied automatically on first database use)
integrations/           terraform-provider-gereh (Go)
```

**Data flow.** The client store (`src/lib/store.ts`) loads `GET /api/state?scope=customer|admin` and calls `POST /api/rpc/<group.method>`. Every method validates its input with Zod and checks authorization on the server. After each mutation the client reloads state. The server re-prices every SKU, so amounts sent by the browser are never trusted.

**Auth.** Passwords are hashed with scrypt. Sessions use a random 256-bit token in an HttpOnly, SameSite=Lax cookie, and only its SHA-256 is stored. OTP codes are also stored hashed. Logins support TOTP 2FA. Rate limits are kept in Postgres.

**Staff roles.** Staff permissions are grouped by area. `owner` can do everything. `support` covers tickets, services and users. `finance` covers billing, coupons, users and reports. `sales` covers products, coupons, announcements, tickets, reports and content. `viewer` is read-only. Staff can impersonate a customer, and the audit log records both identities.

**Teams.** Customers invite colleagues with the role `admin`, `tech` or `billing`. Members work in the owner's account, and their role is enforced on every RPC call.

**Worker** (`src/server/worker`). The worker runs inside each server process, started from `src/instrumentation.ts`; set `WORKER=0` to disable it. Jobs live in a Postgres queue and are claimed with `FOR UPDATE SKIP LOCKED`. Provisioning is idempotent. Periodic jobs:
- every 5 minutes: usage collection and alerts, ticket SLA checks;
- hourly: hourly billing;
- daily: renewals with wallet auto-pay, overdue → suspend → terminate, reminders, Virtualizor reconciliation and cleanup.

**Payments.** Zarinpal v4 and IDPay are supported, and verification is idempotent. VAT is frozen on each invoice. Official invoices are generated from the buyer's legal details.

## Public API and Terraform

- REST API at `/api/v1` with bearer tokens from the panel (read or read/write scope, 120 requests per minute). The OpenAPI 3.1 spec is at `/api/v1/openapi.json`, and the docs page is `/docs/api`.
- `integrations/terraform-provider-gereh` provides the `gereh_dns_record` resource and the `gereh_server` data source. CI runs `go vet`, `go test` and `go build`.

## DevOps services

- **Public pages:** `/devops` is the landing page, with:
  - pain points, 10 services, the engagement process, packages and one-off offers, the SLA table, security commitments, typical journeys, the tool stack, FAQ and the request form;
  - a detail page per service at `/devops/[service]`;
  - an English version at `/en/devops`.
  Pages carry Service, OfferCatalog and FAQ JSON-LD. Content lives in `src/content/devops.ts`; prices there are in Toman, excluding VAT.
- **Request form:**
  - qualifies the lead: company size and stage, current infrastructure, services, budget, urgency and NDA;
  - protected by a honeypot field and a rate limit (3 per hour per IP);
  - emails sales (`DEVOPS_INBOX`) and the client, and notifies owner/sales staff;
  - requests that never become a contract are deleted after 24 months, as the privacy policy states.
- **Admin `/admin/devops`** (permission area `devops`: owner and sales):
  - pipeline stages, assignee, deal value and internal notes;
  - creating a project from a won lead;
  - editing milestones, posting progress reports the customer sees and is emailed, and issuing one-off invoices.
- **Customer panel `/panel/devops`:** projects with milestones, monthly hours used, the next invoice date and progress reports. Retainer invoices are issued daily by the worker (`devops.billing`); each billing period is claimed atomically, so it is never billed twice.

## Content and support

- **Knowledge base** (`src/content/kb.ts`): searchable, with TechArticle JSON-LD.
- **Blog:** staff write posts in Markdown with a live preview at `/admin/blog`. Posts get BlogPosting JSON-LD and an RSS feed. All Markdown is rendered to React elements, never raw HTML, and links are restricted to safe schemes.
- **Live chat:** a widget on public pages and a staff inbox at `/admin/chats`. Visitors are identified by a token (only its hash is stored). The chat suggests relevant KB articles and emails a transcript when it closes.
- **Status page** `/status`: incidents are managed in the admin panel and the page shows 90-day uptime.
- **Reports** `/admin/reports`: finance by Jalali month (net, VAT, refunds, top-ups, product mix, top customers, gateways, outstanding) and SLA per support agent, with an `.xlsx` export.

## Quality gates

- **SEO:** every public page has a title, description, canonical URL, Open Graph and Twitter tags and valid JSON-LD. The sitemap includes KB articles, TLD pages, blog posts and hreflang alternates. `robots.txt` disallows the panel, admin and auth pages.
- **Accessibility:** axe (WCAG 2.1 A/AA) passes on every public page in both languages, at desktop and mobile sizes.
- **Tests:** 179 Vitest tests (unit + server) and 155 Playwright tests. CI runs typecheck, lint, tests, build, e2e and the Terraform provider checks on every push.
- **Performance:** see [`benchmarks/RESULTS.md`](benchmarks/RESULTS.md).

Design and development: [Virgule](https://virgule.studio)
