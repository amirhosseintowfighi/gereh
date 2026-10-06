# گره — Gereh Cloud

Website, customer panel and admin panel for **Gereh**, a Persian (RTL) cloud-server, web-hosting and domain provider.

**Stack:** Next.js 16 (App Router, Turbopack, React Compiler) · React 19 · TypeScript · Tailwind CSS 4 · Vitest · Playwright

## Getting started

```bash
npm ci
npm run dev          # http://localhost:3000
```

The demo login works with any password. An email containing `admin` signs in to the admin panel. The auth page also has one-click demo buttons.

| Script | What it does |
|---|---|
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` | Generates route types (`next typegen`) and runs `tsc` |
| `npm run lint` | ESLint, including the React Compiler rules |
| `npm test` | Vitest unit tests (`tests/unit`) |
| `npm run coverage` | Unit tests with V8 coverage for `src/lib` |
| `npm run test:e2e` | Playwright end-to-end tests (`tests/e2e`) against the production build (run `npm run build` first) |
| `npm run bench` | Lighthouse and HTTP load benchmark against a running server (`BASE_URL`, `RUNS`); writes `benchmarks/RESULTS.md` |
| `npm run assets` | Regenerates the PNG icons and `og.png` in `public/` from `public/icon.svg` |

To use a preinstalled Chromium instead of `npx playwright install`, set `CHROMIUM_PATH` for `test:e2e`, `bench` and `assets`.

Set `NEXT_PUBLIC_SITE_URL` (default `https://gereh.cloud`) so canonical URLs, the sitemap and JSON-LD point at the real domain.

## Layout

```
src/app/(site)      public pages: /, /vps, /hosting, /domains, /about, /contact, /terms, /privacy, /sla
src/app/(auth)      /auth (login, OTP, register, forgot password)
src/app/panel       customer panel: servers (Virtualizor features), hosting, domains/DNS, billing, tickets, keys, account/2FA
src/app/admin       admin panel: users, services, billing, tickets, products, coupons, infra, Virtualizor, audit, settings
src/components      UI (site/, panel/, home/) and shared primitives (ui.tsx, ui-client.tsx)
src/lib/store.ts    data layer: the only seam between UI and backend (see below)
src/lib/cart.ts     cart store (localStorage, cross-tab sync)
src/lib/totp.ts     RFC 6238 TOTP on WebCrypto
src/lib/seo.ts      metadata helpers and JSON-LD builders
docs/               HANDOFF.md (requirements), VIRTUALIZOR.md (API notes), prototype.html
```

## Backend integration

`src/lib/store.ts` is currently an in-browser mock database. Every mutation goes through `api.*`, and each method is async and mirrors one backend endpoint. To connect the real backend (Virtualizor, payment gateways, IRNIC, cPanel, SMS), replace each method body with a `fetch()` call and keep the signature. The UI doesn't need to change. Auth is a client-side mock: the panel guards in `PanelGate` are UX only, so the real API must enforce authorization.

## Quality gates

- **SEO:** every public page has a title, description, canonical, Open Graph/Twitter tags and valid JSON-LD (Organization, WebSite, Product/AggregateOffer, FAQ, Breadcrumb). The repo also includes `sitemap.xml`, `robots.txt` (panel/admin/auth disallowed and `noindex`) and a web manifest. Pages are statically prerendered.
- **Accessibility:** axe (WCAG 2.1 A/AA, colour contrast included) passes on all public pages at desktop and mobile sizes, and Lighthouse accessibility is 100.
- **Tests:** 80 unit and 75 end-to-end tests. CI (`.github/workflows/ci.yml`) runs typecheck, lint, unit tests, build and e2e on every push and PR.
- **Performance:** see [`benchmarks/RESULTS.md`](benchmarks/RESULTS.md).

Design and development: [Virgule](https://virgule.studio)
