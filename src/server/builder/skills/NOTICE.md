# Sources of the builder skills

The skill bodies in `catalog.ts` are original, condensed guidance written for Gereh. No text was copied
verbatim. The ideas were informed by the following public sources:

- Anthropic skills, `frontend-design`, `web-artifacts-builder`, `webapp-testing`, `theme-factory`.
  https://github.com/anthropics/skills (Apache-2.0). These shaped the anti-generic design rules: a palette
  derived from the subject, one memorable element, restrained motion, and a list of "AI slop" patterns.
- obra/superpowers, `systematic-debugging` and `test-driven-development`.
  https://github.com/obra/superpowers (MIT, Copyright (c) 2025 Jesse Vincent). These shaped the
  root-cause-first steps in `testing-and-debugging`.
- addyosmani/web-quality-skills, `accessibility`, `core-web-vitals`, `seo` and `best-practices`.
  https://github.com/addyosmani/web-quality-skills (MIT). These supplied the WCAG 2.2 AA criteria, the Core
  Web Vitals thresholds, the SEO and structured-data rules, and the header and CSP practices.
- OWASP Cheat Sheet Series, Node.js Security Cheat Sheet.
  https://github.com/OWASP/CheatSheetSeries (CC BY-SA 4.0). Only the ideas were used: body limits, output
  encoding, helmet-style headers, cookie flags, rate limiting, and no eval.
- Vazirmatn font. https://github.com/rastikerdar/vazirmatn (SIL OFL 1.1). It is served by Gereh itself, as
  described in `../assets.ts`.
