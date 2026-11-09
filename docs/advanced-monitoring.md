# «پایش پیشرفته» — advanced monitoring

Code: `src/server/watch/` (settings, check, service), `src/lib/watch.ts`, RPC group `watch`, panel tab
«پایش پیشرفته» on `/panel/monitor`, admin card on `/admin/monitor`. Migration `0045_watch`.

## Basic vs advanced

| | Basic (free, every service) | Advanced (paid, per service) |
|---|---|---|
| Purpose | getting a service up | keeping an eye on a service that is up |
| Build/deploy failures, auto-fix, «توضیح بده و درستش کن» | ✓ | ✓ |
| Security detectors (miner, outbound abuse, inbound attack, brute force, unusual I/O) | ✓ (template text) | ✓ (AI wording) |
| Predictive detectors: `service_down`, `memory_leak`, `disk_fill`, `traffic_burn` | — | ✓ |
| AI read of logs and usage | on demand only | per mode |
| Uptime ping every minute, down/up notices | — | ✓ |
| Weekly health report | — | ✓ |
| بافت: automatic maintenance looks (diagnosis + patch, optional auto-fix) | — | ✓ |

## Modes

* **هر وقت خواستم (on_demand):** «الان بررسی کن». One AI check, charged the on-demand price from the wallet
  only when the model wrote the report (the rule-based fallback is free). Plan holders get
  `freeManualPerDay` free checks a day.
* **هر ۳ ساعت (every3h):** a scheduled AI check every 3 hours, plus the predictive detectors and the ping.
* **همیشه روشن (continuous):** the detectors (every 5 min) and the ping (every minute) watch all the time;
  the AI reads only when something new appears (a new crash/OOM/health event, a new incident, a new burst of
  error lines), with a 30-minute cooldown and at most `continuousMaxPerDay` reads a day, plus a daily
  summary. That costs about a tenth of an AI reading everything all the time.

Notifications (panel, email, Telegram/Bale through `notify.send`) only when a check finds something.

## Billing

* The first plan of an account is a free trial (`trialDays`, default 7). The first running service of a new
  account gets it automatically (continuous). Two days before the end the owner is asked to continue; without
  «ادامه پایش» it returns to basic.
* Paid plans are charged a month at a time from the wallet (`debit`, project wallets of a server first),
  renewed at `paidUntil`. Moving up is charged for the days left; moving down waits for the renewal. A short
  wallet ends the plan with a notice.
* The platform pays the tokens of every check (purpose `watch`, `platformCaller`); each check records Gereh's
  real token cost (`watch_checks.cost`, from the model's cost price).

## Prices (admin › پایش هوشمند)

```
costPerCheck = tokensIn × costIn/1M + tokensOut × costOut/1M     (model cost price; sale price if none set)
onDemand     = max(minCheck, ⌈costPerCheck × (1 + margin)⌉₁₀₀₀)
every3h      = ⌈baseMonthly + costPerCheck × checksEvery3h × (1 + margin)⌉₁₀₀₀
continuous   = ⌈baseMonthly + costPerCheck × checksContinuous × (1 + margin)⌉₁₀₀₀
```

Defaults: margin 1 (price = 2 × cost), 6000 in / 700 out tokens a check, 240 checks a month (every3h),
330 (continuous: ~10 anomaly reads a day + the daily summary), base 10,000 Toman. Each price can be overridden;
the admin card shows the computed price beside it, the plans, this month's revenue, token cost and margin.
The model is `settings.model`, else `AI_MONITOR_MODEL`, else the cheapest suitable chat model.

## Jobs

* `watch.tick` (5 min): auto-trials, trial ends and renewals, due checks, weekly reports.
* `watch.ping` (1 min): HTTP GET of the plan's URL (an app's own address by default; servers need one set),
  ok when the status is under 500; two failures in a row notify «پاسخ نمی‌دهد», the next success «دوباره در
  دسترس». Kept 35 days; the panel shows 30-day uptime.
* `builder.maintain` (5 min): بافت apps with a plan (their maintenance agent is the check).

The cost advisor suggests «هر ۳ ساعت» for a paid continuous plan with nothing to report for 30 days.
