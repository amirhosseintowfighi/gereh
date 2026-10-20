/* The builder agent's skills: compact, original guidance in English (the language the model follows
   best), each with a self-review checklist. Sources and licences: ./NOTICE.md. Keep every body under
   ~900 tokens: dense rules, checklists, anti-patterns and short idioms, never essays. */
import type { BuilderStack, QualityCategory } from "@/lib/builder";

export type TaskKind = "generate" | "edit" | "fix" | "maintain";
/** what a skill body may depend on: the site's language (BCP-47), direction, Intl locale and language name */
export type SkillCtx = { lang: string; dir: "rtl" | "ltr"; locale: string; name: string };
export type Skill = {
  id: string;
  /** the stacks it applies to */
  stacks: BuilderStack[];
  /** task kinds that always get it (core), and the ones where a keyword can bring it in */
  core: TaskKind[];
  kinds: TaskKind[];
  /** words in the request (fa + en) that select it */
  triggers: RegExp;
  category: QualityCategory;
  body: string | ((c: SkillCtx) => string);
  checklist: string[];
};

const PERSIAN = `Persian specifics (the site is in Persian):
- Digits: Persian digits in visible numbers via toLocaleString("fa-IR") (thousands separator ٬): «۱٬۲۵۰٬۰۰۰ تومان». Prices in Toman unless the request says otherwise.
- Dates: Jalali via Intl, unless the request asks for another calendar: toLocaleDateString("fa-IR", { year: "numeric", month: "long", day: "numeric" }) gives «۲۸ مهر ۱۴۰۵». The week starts on Saturday (شنبه) and Friday is the weekend. Store ISO dates and never hand-roll the conversion.
- Text: use the zero-width non-joiner (نیم‌فاصله, U+200C) in «می‌شود» and «کتاب‌ها». Use Persian punctuation « ، ؛ ؟ » and guillemets « ». Address the reader with the polite «شما».
- Phone numbers: Iranian mobiles are 09xxxxxxxxx; after normalizing digits, validate with /^(\\+98|0)?9\\d{9}$/. Postal codes have 10 digits.`;
const ARABIC = `Arabic specifics: use Modern Standard Arabic unless a dialect is requested. Show digits with the locale's own digits through Intl (toLocaleString("ar")). Use Gregorian dates unless the request asks for Hijri ({ calendar: "islamic-umalqura" }). Use Arabic punctuation (، ؛ ؟).`;

const BOTH: BuilderStack[] = ["static", "node"];
const BUILD: TaskKind[] = ["generate", "edit"];
const ALL: TaskKind[] = ["generate", "edit", "fix", "maintain"];

export const SKILLS: Skill[] = [
  {
    id: "frontend-design", stacks: BOTH, core: BUILD, kinds: BUILD, category: "ui",
    triggers: /طراحی|ظاهر|زیبا|شیک|مدرن|رنگ|فونت|لوگو|design|style|look|theme|ui\b/i,
    body: `Goal: a site that looks designed for THIS business, not a template.
Before coding, decide in the plan: (1) a palette of 4-6 named colors derived from the subject (a bakery is warm wheat and crust brown, a clinic is clean teal and white, a law firm deep navy and brass), never the default purple/indigo gradient; (2) one type family (Vazirmatn) with a deliberate scale; (3) one memorable element (an unusual hero composition, a bold typographic headline, a signature color block) while everything else stays calm.
Tokens (Tailwind v4 @theme): --color-brand-50..900 from the subject's hue, plus --color-ink (text, not pure #000; e.g. slate-900), --color-surface, --color-accent used sparingly. Contrast first, then mood.
Type scale (rem): 0.875 / 1 / 1.125 / 1.25 / 1.5 / 2 / 2.5-3 (hero). Body 1rem-1.125rem, line-height 1.8-2 for Arabic-script languages (1.6 for Latin). Headings weight 800-900, line-height 1.3-1.4. Max line length ~70ch (max-w-prose).
Spacing scale: 4/8/12/16/24/32/48/64/96 px (Tailwind 1,2,3,4,6,8,12,16,24). Sections py-16 to py-24; related things close, unrelated far. Consistent radius by role (buttons rounded-xl, cards rounded-2xl, chips rounded-full), not one radius on everything.
Layout: let structure carry meaning (numbered steps only for real sequences, dividers only between real groups). Vary rhythm: not every section a centered title plus three identical cards. Mix a split hero, a list with prices, a quote band, a FAQ.
Motion: little and purposeful. One entrance moment at most; hover/focus feedback 150-200ms; transform/opacity only; wrap in @media (prefers-reduced-motion: no-preference).
Content: real, specific copy for the idea in the site language (local names, prices in the local currency, hours, neighbourhoods); no lorem ipsum, no "Feature 1", no fake logos of real brands. Images: inline SVG illustrations, CSS shapes or emoji in a styled tile; never hotlinked photos.
States are design too: empty (friendly sentence plus the next action), loading (skeleton or spinner with text, aria-busy), error (what happened plus how to fix, in the site language), success (clear confirmation).
Anti-patterns ("AI slop"): purple-to-blue gradients everywhere, glassmorphism on every card, giant emoji heroes, identical cards with soft shadow repeated, centered everything, gradient text headlines, one highlighted word in each headline, tracked-out ALL-CAPS eyebrow labels, arrows appended to every button, fade-up on every section, stock "Lorem/John Doe" content, three stats with "+" in every hero.`,
    checklist: ["palette derived from the subject, 4-6 tokens, not default purple/indigo", "one memorable element, the rest restrained", "consistent type and spacing scale", "real content in the site language, no lorem or placeholders", "empty, loading, error and success states designed", "no generic AI-template patterns"],
  },
  {
    id: "i18n-typography", stacks: BOTH, core: BUILD, kinds: BUILD, category: "ui",
    triggers: /زبان|راست|چپ|تاریخ|شمسی|جلالی|rtl|ltr|language|locale|translat|jalali|calendar/i,
    body: (c) => `Target: the site is in ${c.name} (lang="${c.lang}", dir="${c.dir}", Intl locale "${c.locale}").
Document: <html lang="${c.lang}" dir="${c.dir}">, with <meta charset="utf-8"> first in <head>. Write every visible word natively in ${c.name}, as a local copywriter would and never like a translation. This includes labels, buttons, errors, alt text, aria-labels, the <title>, meta tags and JSON-LD. Code comments stay in English.
Direction: use logical CSS only (margin-inline, padding-inline, inset-inline, border-inline-start, text-align: start; in Tailwind ms-/me-, ps-/pe-, start-/end-, text-start, rounded-s-/rounded-e-). Never use ml-/mr-/pl-/pr-/left-/right- for layout that should mirror. ${c.dir === "rtl" ? "In RTL, forward-pointing icons (arrows, chevrons) point left: flip them with -scale-x-100 or rtl:rotate-180." : "The layout must still mirror correctly if dir is switched."}
Font by script: for Persian, Arabic and Urdu, use the Vazirmatn stylesheet given in the stack rules (Gereh serves it from its own host): font-family Vazirmatn, Tahoma, sans-serif. For Latin, Cyrillic and Greek, use the system stack Inter, ui-sans-serif, system-ui, "Segoe UI", Roboto, "Noto Sans", Arial, sans-serif. For other scripts, put "Noto Sans <Script>" first, then system-ui. Never download other web fonts; the panel preview and many visitors cannot reach font CDNs.
Numbers, prices and dates: always format with Intl and the locale "${c.locale}". Examples: n.toLocaleString("${c.locale}"), new Intl.NumberFormat("${c.locale}", { style: "currency", currency }) for prices, d.toLocaleDateString("${c.locale}", { dateStyle: "long" }) for dates. Never hand-format digits or dates. Store ISO dates and integer amounts. Inputs accept any digits: before validating, normalize them with s.replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).
Bidi safety: wrap opposite-direction fragments (phone numbers, emails, URLs, codes or a brand in another script) in <bdi> or <span dir="ltr|rtl">. Phone, email, URL and code inputs get dir="ltr", the right type and inputmode.
Typography: body line-height is 1.7 to 2 for Arabic-script, Devanagari and Thai, and about 1.6 for Latin. No letter-spacing on cursive scripts (Arabic and Persian), since it breaks letter joining. No synthetic italics for Arabic script or CJK; use weight or color instead. Headline length differs by language, so do not hard-cut text.
Local conventions: use the target audience's currency, phone, address and date formats, and the first day of the week.${c.lang === "fa" ? "\n" + PERSIAN : c.lang === "ar" ? "\n" + ARABIC : ""}`,
    checklist: ["html lang and dir match the site language; utf-8 charset", "all visible copy native in the site language, not translated-sounding", "only logical spacing/position utilities; directional icons mirror in RTL", "font suited to the script; no external web fonts", "numbers, prices and dates via Intl with the site locale", "LTR fields (phone, email, URL) have dir=ltr and inputmode"],
  },
  {
    id: "responsive-mobile-first", stacks: BOTH, core: BUILD, kinds: BUILD, category: "ui",
    triggers: /موبایل|گوشی|تبلت|واکنش|ریسپانسیو|mobile|responsive|tablet/i,
    body: `Most visitors are on phones: design at 360px first, then enhance at sm 640, md 768, lg 1024, xl 1280. Base classes are mobile; add sm:/md:/lg: for larger screens only.
Viewport: <meta name="viewport" content="width=device-width, initial-scale=1">; never maximum-scale=1 or user-scalable=no.
No horizontal scroll at 320px: no fixed widths over ~320px (use w-full max-w-*), images and SVG max-width:100% height:auto, long words and URLs wrap (overflow-wrap:anywhere / break-words), tables in an overflow-x-auto wrapper, grids collapse to one column (grid-cols-1 sm:grid-cols-2 lg:grid-cols-3), flex rows wrap (flex-wrap) or stack (flex-col sm:flex-row). Avoid 100vw (includes the scrollbar); prefer w-full. Use min-h-dvh, not h-screen, for full-height areas on mobile.
Touch: every tap target at least 44x44px (py-3 px-4 on buttons, h-11 inputs, icon buttons w-11 h-11), at least 8px apart. Never rely on hover for information or for opening menus. Sticky header thin (h-14 to h-16) with a menu button (aria-expanded, aria-controls) that opens a full-width panel; close it on link click and on Escape.
Fluid type: hero text-3xl sm:text-4xl lg:text-5xl or clamp(1.75rem, 1.2rem + 2.5vw, 3rem); body never below 16px (prevents iOS zoom on focus for inputs too: inputs text-base).
Content order: the main action (book, buy, call) visible in the first screen on mobile; a sticky bottom call-to-action bar is fine for one primary action; phone numbers are tel: links.
Forms on mobile: one column, labels above fields, correct type/inputmode/autocomplete (name, tel, email, street-address), enterkeyhint where useful.
Containers: mx-auto max-w-6xl px-4 sm:px-6; side gutter at least 16px.
Test mentally at 320, 375, 768 and 1280 widths before finishing.`,
    checklist: ["designed mobile-first with sm/md/lg enhancements", "viewport meta present and zoom not disabled", "no fixed widths or 100vw that overflow at 320px; tables scroll in a wrapper", "tap targets ≥44px, nothing needs hover", "mobile menu works with aria-expanded and closes", "body ≥16px and fluid headings"],
  },
  {
    id: "accessibility-wcag", stacks: BOTH, core: BUILD, kinds: BUILD, category: "a11y",
    triggers: /دسترس|نابینا|صفحه[‌ ]?خوان|a11y|accessib|wcag|screen reader/i,
    body: `Target WCAG 2.2 AA.
Semantics first: one <h1>, then h2/h3 in order; landmarks <header>, <nav aria-label>, <main id="main">, <footer>; lists as <ul>/<ol>; buttons are <button type="button"> (actions), links are <a href> (navigation). A skip link as the first focusable element: <a href="#main" class="sr-only focus:not-sr-only">(skip to content, in the site language)</a>.
Text alternatives: every <img> has alt (empty alt="" when decorative); inline SVG icons get aria-hidden="true", meaningful SVG gets role="img" and aria-label; emoji used as decoration aria-hidden="true"; icon-only buttons get an aria-label in the site language.
Forms: every input, select and textarea has a visible <label for=id> (placeholder is not a label); group radios/checkboxes in <fieldset><legend>; required fields marked with text, not color alone, plus required/aria-required; errors in text next to the field, linked with aria-describedby and aria-invalid="true", summarized in a role="alert" region; move focus to the first invalid field on submit; never clear what the user typed after an error (no re-entry, 3.3.7).
Keyboard: everything works with Tab/Shift+Tab/Enter/Space/Escape, no keyboard traps, logical DOM order (do not reorder visually with order-* in ways that break reading). Modals/menus: focus moves in, Escape closes, focus returns to the trigger.
Focus visible: never outline:none without a replacement; use focus-visible:ring-4 with at least 3:1 contrast; sticky headers must not hide the focused element (scroll-padding-top equal to header height, 2.4.11).
Contrast: text 4.5:1 (large text ≥24px or bold ≥18.7px: 3:1); UI component borders and focus rings 3:1. Check brand-colored buttons with white text: brand-600/700, rarely 500. Never convey state by color alone (add an icon or text).
Targets at least 24x24px (2.5.8; 44px preferred). Any drag action needs a click alternative.
Dynamic content: status messages in aria-live="polite" (role="status"), urgent errors role="alert"; loading regions aria-busy="true".
Motion: honor prefers-reduced-motion (disable smooth scroll, parallax, autoplay); nothing flashes more than 3 times per second; carousels have pause controls.
ARIA only when HTML has no native element; a wrong ARIA role is worse than none.`,
    checklist: ["landmarks, one h1 and ordered headings, skip link", "every img has alt; decorative icons aria-hidden; icon buttons labelled", "every form control has a visible label; errors are text, linked with aria-describedby", "keyboard operable with visible focus rings", "text contrast ≥4.5:1, UI ≥3:1, no color-only meaning", "live regions for status; prefers-reduced-motion respected"],
  },
  {
    id: "web-security", stacks: BOTH, core: ALL, kinds: ALL, category: "security",
    triggers: /امن|امنیت|رمز|هک|security|secure|password|xss|csrf/i,
    body: `Assume every input is hostile (OWASP Top 10).
XSS / output encoding: insert user or API data with textContent, setAttribute, createElement, or a tiny escape() for HTML (& < > " '). Never innerHTML/outerHTML/insertAdjacentHTML/document.write with interpolated data. No inline event handlers (onclick=...) and no inline <script> blocks with logic: attach listeners in a .js file so a CSP can forbid inline scripts. Never eval, new Function, setTimeout("string"), or javascript: URLs. URLs from users: allow only http(s) via new URL() before using in href/src.
Secrets: never in client code, HTML, README or the repo. Server reads them from process.env (DATABASE_URL, API keys); if a feature needs a key the customer has not given, read process.env.X and degrade gracefully. Never log secrets, tokens, passwords or the whole process.env or req.headers.
Links: target="_blank" always with rel="noopener noreferrer". Assets only over https (no http:// mixed content).
Node/Express headers (helmet-equivalent, without adding a dependency): app.disable("x-powered-by"); a middleware setting X-Content-Type-Options: nosniff; X-Frame-Options: SAMEORIGIN; Referrer-Policy: strict-origin-when-cross-origin; Permissions-Policy: camera=(), microphone=(), geolocation=(); Cross-Origin-Opener-Policy: same-origin; and a CSP: default-src 'self'; script-src 'self' https:; style-src 'self' 'unsafe-inline' https:; font-src 'self' https: data:; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'. (style 'unsafe-inline' is needed by the Tailwind browser build; scripts stay without 'unsafe-inline'. Gereh rewrites CDN hosts at deploy, so allow https: rather than one host.) HTTPS and HSTS are terminated by Gereh.
Input validation on the server at the edge: types, required, length limits, formats (phone, email), allow-lists for enums; reject with 400 and a message in the site language. Body limits express.json({ limit: "100kb" }); for uploads cap size and count, check type by extension and content, store outside public/, generate the file name.
SQL: parameterized queries only ($1, $2); never build SQL with string concatenation or template literals of user data; whitelist column names for sorting.
Auth (only when asked): hash passwords with crypto.scrypt (N=16384, r=8, p=1, 16-byte random salt, timingSafeEqual) or bcrypt/argon2; sessions as random 32-byte tokens in cookies HttpOnly; Secure; SameSite=Lax; Path=/; expire them; regenerate on login; rate limit login and form posts (an in-memory map of ip → timestamps, 5-10 per minute) and answer 429. CSRF: SameSite=Lax cookies plus checking the Origin header on state-changing requests (or a per-session token).
CORS: none by default (same origin); if needed, an explicit origin allow-list, never "*" with credentials.
Errors: a generic message (in the site language) to the client, details only in server logs; no stack traces in responses. Dependencies: as few as possible, well-known, pinned with caret, nothing for what Node already does.`,
    checklist: ["no innerHTML/insertAdjacentHTML/document.write with data; no eval/new Function; no inline handlers", "no secrets or keys in code; env only; never logged", "target=_blank has rel=noopener noreferrer; no http:// assets", "security headers and CSP set (node)", "server-side validation, length limits, parameterized SQL", "cookies HttpOnly/Secure/SameSite, scrypt/bcrypt, rate limiting (when auth exists)", "errors leak nothing"],
  },
  {
    id: "node-backend", stacks: ["node"], core: ALL, kinds: ALL, category: "backend",
    triggers: /سرور|api|بک[‌ ]?اند|پایگاه[‌ ]?داده|دیتابیس|backend|server|database|express/i,
    body: `Shape of server.js (CommonJS, no build step): requires → config from env → app + security middleware → static → /healthz → API routers → 404 JSON for /api → error middleware → listen → graceful shutdown.
Config: const PORT = Number(process.env.PORT) || 8080; listen on "0.0.0.0". DATABASE_URL from env when a Gereh database is linked; when absent, fall back to in-memory storage so the app still starts (log one line saying so, never the URL).
Health: GET /healthz answers 200 {"ok":true} quickly without touching slow dependencies (Gereh's probe uses /healthz when the code defines it, else /). Keep it before any auth middleware.
Validation at the edge: one small validate(body) per route returning { data } or { error }; trim strings, cap lengths (names 120, text 1000), normalize non-ASCII digits, check enums against allow-lists, reject unknown shapes. Never trust client-side validation or prices sent by the client: recompute totals on the server from your own catalog.
Errors: wrap async handlers: const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next); final middleware app.use((err, req, res, next) => { console.error(err.message); res.status(err.status || 500).json({ error: "<a short message in the site language>" }); }). 4xx answers are JSON {"error": "<message in the site language>"}. Invalid JSON bodies → 400, not 500.
Database (pg): one Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 }); pool.on("error", ...) logs and keeps running; CREATE TABLE IF NOT EXISTS at startup with proper types (TEXT, INTEGER, BIGINT/NUMERIC for money in the smallest unit, TIMESTAMPTZ DEFAULT now(), JSONB for loose data), indexes for lookups; parameterized queries only; transactions (BEGIN/COMMIT/ROLLBACK with a client) for multi-step writes.
Lists: paginate (?page=&limit= with limit capped at 50, ORDER BY id DESC LIMIT $1 OFFSET $2) and return { items, total }. Idempotency: accept an optional client-generated request id for orders/bookings and ignore duplicates (UNIQUE column + ON CONFLICT DO NOTHING) so double clicks do not double-book.
Admin-only data (lists of bookings, orders): protect with a token from process.env.ADMIN_TOKEN compared with crypto.timingSafeEqual; if unset, disable the route.
Logging: one line per error with context, no personal data dumps, never secrets, env or full request bodies.
Shutdown: process.on("SIGTERM", () => { server.close(() => pool ? pool.end().finally(() => process.exit(0)) : process.exit(0)); setTimeout(() => process.exit(0), 10000).unref(); }); also log unhandledRejection.
package.json: "scripts": {"start": "node server.js"}, "engines": {"node": ">=20"}, only the dependencies you require (express, pg when used), caret-pinned, no devDependencies, no postinstall scripts.`,
    checklist: ["PORT from env, listens on 0.0.0.0", "GET /healthz returns 200 quickly", "validation at the edge with length limits; server recomputes prices", "async errors handled by middleware; JSON error bodies", "pg Pool with timeouts, parameterized queries, pagination", "SIGTERM graceful shutdown", "minimal caret-pinned dependencies; no secrets in logs"],
  },
  {
    id: "performance-seo", stacks: BOTH, core: [], kinds: BUILD, category: "performance",
    triggers: /سئو|گوگل|سرعت|جستجو|seo|google|speed|fast|performance|lighthouse/i,
    body: `Core Web Vitals targets: LCP ≤2.5s, INP ≤200ms, CLS ≤0.1.
LCP: the hero text/visual is in the initial HTML (not rendered by JS); no render-blocking scripts beyond the two required tags; app scripts at the end of body or defer.
CLS: every img/iframe/video has width and height (or aspect-ratio); reserve space for dynamic content (cart counts, messages) with min-height; fonts use font-display: swap (the Vazirmatn stylesheet already does).
Images: inline SVG or CSS for illustration; when a raster image is unavoidable, loading="lazy" decoding="async" for below-the-fold, never lazy for the hero; sized to display.
JavaScript: vanilla and small; event delegation for long lists; no heavy libraries for simple effects; debounce input handlers; avoid layout thrash (read then write).
Caching (node): express.static(dir, { maxAge: "1h" }); compress is done by the platform.
SEO per page: unique <title> (≈50-60 chars, brand at the end), <meta name="description"> (≈150 chars), one h1, meaningful headings, descriptive link text (not "click here"), <link rel="canonical"> when the final URL is known, lang/dir on html.
Social: og:title, og:description, og:type=website, og:locale from the site language (fa_IR, en_US …), twitter:card=summary; an og:image only if a real one exists.
Files: robots.txt (User-agent: * / Allow: /, plus Sitemap: line when the domain is known) and sitemap.xml listing the pages with relative-free absolute URLs only when the domain is known; otherwise skip the sitemap rather than invent a domain.
Structured data: one JSON-LD <script type="application/ld+json"> describing only visible facts (LocalBusiness/Restaurant/BeautySalon with name, address, telephone, openingHours; Product with offers in the real currency (Toman is IRR ×10); Event with startDate). No fake ratings or reviews.
Favicon: an inline SVG data URI or favicon.svg.`,
    checklist: ["hero rendered in HTML; scripts deferred or at end", "media has dimensions; space reserved for dynamic content", "below-the-fold images lazy, hero not lazy", "unique title and meta description; one h1", "og tags; JSON-LD only with visible facts", "robots.txt (and sitemap only with a known domain)"],
  },
  {
    id: "forms-and-states", stacks: BOTH, core: [], kinds: BUILD, category: "ui",
    triggers: /فرم|ثبت[‌ ]?نام|رزرو|نوبت|سفارش|تماس|ورود|form|signup|booking|order|contact|checkout/i,
    body: `Every form validates twice: in the browser for speed, on the server for truth; the same rules and messages (in the site language) in both.
Markup: <form novalidate> with JS validation (consistent messages in the site language instead of browser bubbles), each field: <label for>, input with name, type, autocomplete (name, tel, email, street-address, postal-code), inputmode, maxlength, required; a <p id="x-err" class="text-sm text-rose-700"> under it, hidden until needed.
Validate on submit, then live on input for fields already shown as invalid (do not shout while the user is still typing the first time). Normalize non-ASCII digits and trim before checks. Messages say what to do ("Enter a mobile number like …" with a local example), not just "invalid".
On error: set aria-invalid="true" and aria-describedby to the error element, focus the first invalid field, keep every value the user typed.
Pending: disable the submit button and show a spinner + text ("Sending…"), aria-busy on the form; prevent double submit; re-enable in finally.
Success: replace or annotate the form with a clear confirmation (role="status"), including what happens next  and a reference number when the server returns one; reset fields only after success.
Failure: network errors and 5xx show a retry message and keep data; 4xx shows the server's error next to the right field when it names one.
Static sites (no server): simulate submission locally with a success message and offer tel:/mailto: or a WhatsApp/Telegram link as the real channel; never send data to third-party endpoints.
Selects for dates/times: native <input type="date"> is fine; show the chosen date formatted for the site locale next to it (Jalali for Persian sites). Prevent past dates (min attribute + server check).
Empty states for lists (no bookings yet), loading skeletons for fetched content, and an error box with a retry button: never a blank area.`,
    checklist: ["labels, autocomplete, inputmode and maxlength on every field", "client and server validation with the same messages", "aria-invalid + aria-describedby; focus first invalid; values kept", "submit disabled with pending text; no double submit", "clear success message with next step", "network failure keeps data and offers retry"],
  },
  {
    id: "testing-and-debugging", stacks: BOTH, core: ["fix", "maintain"], kinds: ["fix", "maintain"], category: "backend",
    triggers: /خطا|باگ|کار نمی[‌ ]?کند|درست کن|ارور|bug|error|fix|broken|crash/i,
    body: `Root cause before any patch. A fix that only hides the symptom is a failure.
1. Read the evidence completely: the whole log tail, the first error (not the last cascade), file paths and line numbers, exit codes, probe results. Classify it: install (missing/invalid package.json, unknown dependency, bad version), start (no start script, missing entry file, syntax error), listen (wrong port/host, crash before listen), runtime (unhandled rejection, DB connection, timeout), health (no /healthz or it is slow), static (no index.html at root).
2. Reproduce mentally from the files: follow the start command → entry file → requires → listen → health route. Find where the actual data or control flow diverges from what the platform expects (PORT from env, 0.0.0.0, /healthz, dependencies listed).
3. One hypothesis, stated in the plan in one line, then the smallest change that removes the cause. Do not refactor, rename or restyle anything unrelated; do not touch files the cause does not involve.
4. Verify by reasoning: after your change, would the same log line still appear? Would the build and start steps succeed? Would the health probe pass within 60 seconds? Check you did not remove existing behaviour.
5. If the logs show no clear cause, say so honestly, add defensive handling where the risk is real (timeouts on DB connections, error middleware, unhandledRejection logging, pool.on("error")) and add a short console.error line that will reveal the cause next time.
6. Never paper over with try/catch that swallows errors silently, never disable validation or security headers to make an error go away, never change the start command to something that skips the app.
In <summary>, explain in plain words, in the owner's language: what broke, why, what you changed, and whether the owner needs to do anything (e.g. a bigger plan for OOM).`,
    checklist: ["cause identified from the first real error", "smallest change; unrelated code untouched", "start → listen → health path verified", "no silent catch, no disabled checks", "plain explanation of cause and change"],
  },
  {
    id: "landing-copywriting", stacks: BOTH, core: [], kinds: BUILD, category: "ui",
    triggers: /لندینگ|معرفی|تبلیغ|فروش|متن|شعار|بازاریابی|landing|marketing|copy|slogan/i,
    body: `Write like a skilled local copywriter of the site language and audience, never like a translation.
Hero: a concrete promise in 4-9 words about the customer's outcome , a subline with the proof or the how (one sentence), one primary call to action as a verb ("Book now", "Order") and at most one secondary.
Benefits over features: each card answers "what is in it for me?". Use numbers that are plausible and specific (12 years of experience, 24-hour delivery in the city) and never claim certifications, awards or partners that were not given.
Trust: real-feeling testimonials with local first names and a specific detail, clear prices or price ranges in the local currency, address/hours/phone, return or cancellation policy in one line.
FAQ: 4-6 real objections (price, time, payment, cancellation, parking/delivery) answered in 1-2 sentences.
Tone: respectful and warm but not exaggerated (formal address where the language has one); no shouting caps, no emoji spam (one per heading at most, often none), no clichés like "best quality at the lowest price".
Microcopy: buttons say the action and object ("Book the appointment", not "Submit"); errors say how to fix; empty states invite the next step.`,
    checklist: ["outcome-focused hero with one clear verb CTA", "benefits, specific plausible numbers, no invented awards", "prices, hours, contact and policies visible", "FAQ answers real objections", "natural native tone without clichés or emoji spam"],
  },
  {
    id: "dashboard-data", stacks: BOTH, core: [], kinds: BUILD, category: "ui",
    triggers: /داشبورد|پنل مدیریت|جدول|گزارش|آمار|نمودار|مدیریت سفارش|admin|dashboard|table|report|chart/i,
    body: `Admin views are for scanning and acting.
Layout: a top bar with title and the main action, a filter row (search input with debounce 300ms, status select, date range), then the table; summary tiles above only for numbers someone acts on (today's bookings, pending orders), each with a label and a locale-formatted value.
Tables: <table> with <caption class="sr-only">, <th scope="col">, numbers aligned to the end with tabular-nums, dates in Jalali with time, status as text badges (not color only), row actions as buttons with aria-label that names the row. Wrap in overflow-x-auto; on phones turn rows into stacked cards (hidden md:table plus a card list) when there are more than 4 columns.
Data: paginate on the server (limit ≤50, page numbers formatted for the locale), show total count, keep filter state in the URL query, sort by a whitelisted column. Empty state with a helpful sentence; loading skeleton rows; error row with retry.
Destructive actions confirm with the item's name and offer undo where cheap. Export as CSV with UTF-8 BOM so Excel shows non-Latin text correctly.
Charts: inline SVG bars/lines are enough; label axes with locale-formatted numbers; never a chart without the numbers available as text.
Protect every admin route and page behind the server-side token check; never ship admin data in public HTML.`,
    checklist: ["server-side pagination, filters and whitelisted sorting", "accessible table markup with scope and caption", "mobile fallback for wide tables", "empty, loading and error states", "admin routes protected on the server"],
  },
  {
    id: "ecommerce-basics", stacks: BOTH, core: [], kinds: BUILD, category: "backend",
    triggers: /فروشگاه|سبد|خرید|محصول|پرداخت|سفارش|کالا|shop|store|cart|checkout|product|ecommerce/i,
    body: `Catalog: products with id, name, short description, integer price in the local currency (Toman for Iranian shops), stock, category; show prices with Intl for the site locale, discounts as old price struck through plus the new one; out-of-stock disables the add button with text.
Cart: kept in memory (and in localStorage inside try/catch); badge with the count (aria-live); line items with quantity steppers (buttons with aria-label, min 1, max stock), remove, subtotal, shipping rule shown up front , total.
Checkout: name, mobile, region/city, full address, postal code in the local format, optional note; payment on delivery or a placeholder for a local payment gateway (for Iran: Zarinpal, IDPay) that the owner connects later via env keys; never collect card numbers on the site.
Server (node): recompute every price and total from the server catalog (ignore client prices), validate quantities and stock in one transaction, store the order with a status (pending, confirmed, shipped, cancelled) and an order number, idempotent on a client request id, answer with the order number. Static: show a summary and a tel:/messenger link to finalize.
Trust: return policy, delivery time, contact, and a clear confirmation page with the order number.`,
    checklist: ["prices are integers in the local currency, formatted with Intl", "server recomputes totals and checks stock", "no card data collected; gateway via env later", "idempotent order creation with an order number", "clear cart, shipping rules and confirmation"],
  },
  {
    id: "auth-accounts", stacks: ["node"], core: [], kinds: BUILD, category: "security",
    triggers: /ورود|عضویت|حساب کاربری|رمز عبور|پروفایل|login|signup|sign in|account|password|auth/i,
    body: `Only build accounts when the request needs them; prefer an admin token for a single owner.
Passwords: crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }) with a 16-byte random salt stored as salt:hash hex; compare with crypto.timingSafeEqual; minimum 8 characters; never store or log plain text.
Sessions: crypto.randomBytes(32).toString("base64url") stored server-side (table sessions: token hash, user id, expires_at); cookie "sid" with HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age 7-30 days; new token on login, delete on logout; check expiry on every request.
Login: one generic error ("wrong email or password") for both unknown user and wrong password; rate limit per IP and per account (5 per 15 minutes) with 429 and a message in the site language; allow paste and password managers (autocomplete="current-password"/"new-password").
CSRF: SameSite=Lax plus an Origin/Referer check on POST/PUT/DELETE. Authorization: check ownership on every query (WHERE user_id = $1), never trust ids from the client alone.
OTP by SMS needs a provider key from env; if absent, explain to the owner instead of faking it.`,
    checklist: ["scrypt/bcrypt with salt and timing-safe compare", "HttpOnly Secure SameSite session cookies with expiry", "generic login errors and rate limiting", "Origin check on state-changing requests", "every query scoped to the signed-in user"],
  },
];
