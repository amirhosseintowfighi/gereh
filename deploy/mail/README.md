# Mail service (سرویس ایمیل) on Stalwart Mail Server

Gereh manages domains, mailboxes, aliases and SMTP logins on a self-hosted
[Stalwart](https://stalw.art) server through its REST management API. Mail sent through
`POST /api/mail/v1/send` goes out over SMTP with nodemailer (DKIM-signed by Gereh with each domain's
own key). Without `STALWART_URL` the panel uses the simulator: nothing leaves the machine and the
worker invents delivery events.

## 1. Run Stalwart

```sh
kubectl create namespace gereh-mail
kubectl -n gereh-mail create secret generic stalwart --from-literal=admin-password="$(openssl rand -base64 24)"
kubectl apply -f deploy/mail/stalwart.yaml
```

Point these at the `stalwart-public` LoadBalancer IP and set a PTR (reverse DNS) for it to `mx.gereh.net`:

| record | value |
| --- | --- |
| `mx.gereh.net` A | LB IP (what customers' MX records point to) |
| `mail.gereh.net`, `smtp.gereh.net` A | LB IP (IMAP/POP3 and submission for clients) |
| `return.gereh.net` MX | `mx.gereh.net` (customers' return-path CNAME targets this) |
| `_spf.gereh.net` TXT | `v=spf1 ip4:<LB IP> ~all` (customers' SPF includes this) |

In the Stalwart web admin (port 8080, through `kubectl port-forward`): issue TLS certificates
(ACME) for the host names above, and create an API key for Gereh.

## 2. Relay login for API-sent mail

Create an individual principal (for example `gereh-relay`) with a strong secret and permission to
send as any address (`Settings → Authentication → allow sending as any address` for that principal).
Gereh submits API messages with this login.

## 3. Hooks back into Gereh

Generate a shared secret: `openssl rand -hex 24`.

* **MTA hook** (Settings → SMTP → Hooks): URL `https://gereh.net/api/mail/hook`, stage **DATA**,
  Basic auth with the secret as the password, on both inbound (port 25) and submission sessions.
  Gereh answers `accept`, `discard` (DEV mode, blocklist, drop rules), `quarantine` (spam above the
  domain's threshold) or `reject` (unknown recipient, over limit, no credit). SMTP submissions are
  logged and counted against the plan; Gereh rewrites the envelope sender to a VERP return path
  (`b-<message id>@bounces.<domain>`).
* **Webhooks** (Settings → Telemetry → Webhooks): URL `https://gereh.net/api/mail/events`, signing
  key = the secret, events `delivery.delivered`, `delivery.dsn-perm-fail`, `delivery.dsn-temp-fail`,
  `delivery.failed`. Gereh finds the message by the VERP address in the event and records
  delivered / bounced / failed per recipient. The normalized form
  `{ "events": [{ "messageId": "msg-…", "type": "delivered", "recipient": "…" }] }` is accepted too.

Field names in Stalwart's hook and webhook payloads differ between releases; Gereh parses them
tolerantly, but verify against the version you deploy (test by sending to a known-bad address and
watching the message's events in the panel).

## 4. Environment for the Gereh app

```sh
STALWART_URL=http://stalwart-admin.gereh-mail.svc:8080
STALWART_TOKEN=<API key>            # or STALWART_ADMIN=admin:<password>
MAIL_SMTP_HOST=stalwart-public.gereh-mail.svc  MAIL_SMTP_PORT=587
MAIL_SMTP_USER=gereh-relay          MAIL_SMTP_PASS=<relay secret>
MAIL_HOOK_SECRET=<shared secret>    # ≥ 16 chars
# public names shown to customers (defaults in brackets)
MAIL_MX_HOST=mx.gereh.net  MAIL_SPF_INCLUDE=_spf.gereh.net  MAIL_RETURN_HOST=return.gereh.net
MAIL_IMAP_HOST=mail.gereh.net  MAIL_SUBMIT_HOST=smtp.gereh.net
```

Check the connection from `/admin/mail` → «تست اتصال».

## Operations

* Outbound port 25 must be open at the provider; warm the IP up slowly and watch blocklists.
* Logs are kept 90 days (daily `mail.daily` job), which also refreshes mailbox usage from Stalwart.
* Billing is hourly (`mail.billing`); without credit, domains are suspended (`suspendReason=credit`)
  and Gereh rejects their sends at the API and the MTA hook until the wallet holds 24 hours of cost.
