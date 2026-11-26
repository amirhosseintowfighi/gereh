# «راه‌اندازی کسب‌وکار» — small-business packages and the simple panel

The public site and the customer panel speak to two audiences. A business owner (a shop, a clinic, a café) wants
an outcome: their shop online with a payment gateway. A developer wants resources: CPU, RAM, NVMe. The home page now
asks the first question first; everything technical stays, under its own heading.

## What is where

| Part | Code |
|---|---|
| Packages, goals, steps, FAQ (the one place to change contents and prices) | `src/lib/business.ts` |
| Public page `/business` | `src/app/(site)/business/page.tsx`, `src/components/site/business-sections.tsx`, `src/components/site/business.tsx` (request form) |
| Home page: goal picker, packages, then the developer section (`#developers`) | `src/app/(site)/page.tsx` |
| Request RPC `business.request` | `src/server/rpc/business.ts` |
| Simple panel, `account.setPanelView` | `src/components/panel/simple.tsx`, `src/server/rpc/account.ts`, migration `0046_business` |
| Tests | `tests/server/business.test.ts`, `tests/e2e/flows.spec.ts` («small businesses») |

## Packages

Four packages, each a done-for-you service with a one-time setup fee and a fixed monthly fee (Toman, excluding VAT):
«شروع», «فروشگاه», «رشد» and «سازمانی» (priced after a call; its button goes to the DevOps request form). The page
never names a resource; it lists what the customer gets in plain words.

The prices in `BIZ_PACKAGES` are a first draft: review them before launch.

## Request flow

1. The visitor picks a goal (home page or `/business`) or a package card. `?goal=` and `?pkg=` preselect the package
   in the form; the form asks only for a name, the business name and a mobile number (email optional).
2. `business.request` (public, honeypot, 3 per hour per IP) stores a lead in `devops_leads` with `services: ["business"]`,
   `pkg` = the package id, `value` = its setup fee and `source` = `business:<page>`, emails sales (`SALES_INBOX`, else
   `DEVOPS_INBOX`, else `CONTACT_INBOX`) and, when an email was given, the customer; owner and sales staff get an
   in-app notice.
3. Sales work the lead in `/admin/devops` like any other. «ساخت پروژه» on a business lead prefills the title, plan
   «پروژه» and the package's monthly fee; from there the worker issues the monthly invoices and the customer follows
   the milestones and updates in the panel.

## Simple panel («نمای ساده»)

`users.panel_view` is `simple`, `full` or null. Null means: simple when the account runs no servers, apps or databases,
full otherwise. The choice is per person (a team member keeps their own) and is switched from the account menu or
the sidebar.

The simple view shows four cards (سایت من، پرداخت‌ها، پیام به پشتیبانی، تمدید), the progress of any project being
built for the customer, and a short menu. Every page of the full panel still works by its address.
