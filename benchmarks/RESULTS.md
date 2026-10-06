# Benchmarks

Generated 2026-10-06T17:38:48.324Z · Node v22.22.0 · median of 3 Lighthouse runs · production build (`next start`).

Lighthouse uses simulated throttling (mobile: Moto G Power on slow 4G; desktop: cable). Scores are Performance / Accessibility / Best Practices / SEO.

## Lighthouse

| Page | Device | Perf | A11y | BP | SEO | FCP | LCP | TBT | CLS | Transfer |
|---|---|---|---|---|---|---|---|---|---|---|
| `/` | mobile | 88 | 100 | 100 | 100 | 1370 ms | 3448 ms | 201 ms | 0.013 | 410 KB |
| `/vps` | mobile | 91 | 100 | 100 | 100 | 1223 ms | 3397 ms | 67 ms | 0.000 | 366 KB |
| `/hosting` | mobile | 91 | 100 | 100 | 100 | 1221 ms | 3365 ms | 121 ms | 0.003 | 366 KB |
| `/domains` | mobile | 91 | 100 | 100 | 100 | 1220 ms | 3163 ms | 143 ms | 0.000 | 364 KB |
| `/about` | mobile | 92 | 100 | 100 | 100 | 1372 ms | 3353 ms | 69 ms | 0.001 | 383 KB |
| `/auth` | mobile | 93 | 100 | 100 | 66 | 1225 ms | 3134 ms | 100 ms | 0.000 | 351 KB |
| `/` | desktop | 100 | 100 | 100 | 100 | 376 ms | 731 ms | 0 ms | 0.000 | 445 KB |
| `/vps` | desktop | 100 | 100 | 100 | 100 | 381 ms | 724 ms | 3 ms | 0.000 | 429 KB |
| `/hosting` | desktop | 100 | 100 | 100 | 100 | 376 ms | 715 ms | 1 ms | 0.011 | 429 KB |
| `/domains` | desktop | 100 | 100 | 100 | 100 | 380 ms | 736 ms | 0 ms | 0.001 | 426 KB |
| `/about` | desktop | 100 | 100 | 100 | 100 | 375 ms | 719 ms | 0 ms | 0.002 | 429 KB |
| `/auth` | desktop | 100 | 100 | 100 | 66 | 376 ms | 675 ms | 0 ms | 0.000 | 420 KB |

`/auth` scores lower on SEO by design: it is `noindex`.

## HTTP load (autocannon, 50 connections, 15s, single `next start` process)

| Path | Req/s | p50 | p99 | Errors | Throughput |
|---|---|---|---|---|---|
| `/` | 251 | 187 ms | 404 ms | 0 | 66.3 MB/s |
| `/vps` | 351 | 129 ms | 320 ms | 0 | 67.2 MB/s |
| `/sitemap.xml` | 1032 | 44 ms | 82 ms | 0 | 2.1 MB/s |
