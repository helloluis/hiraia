# Crypto donations: optional donor email, alerts and report

`/support` → "Donate with crypto" (thirdweb CheckoutWidget, see `src/components/donate/`).

## Optional email
- The field is optional. **Blank = anonymous**: no request is made, nothing is stored, and the checkout
  carries `purchaseData: {purpose: "hiraia-donation"}` exactly as before.
- With an email, `POST /api/donations/session` (same-origin, JSON ≤ 2 KB, 20/IP/hour, basic email shape,
  network/token/amount re-validated) stores `donation_sessions(ref, email, chain, token, amount, created_at)`
  in the private `HIRAIA_DB_PATH` database and returns a random 22-character `ref`. The checkout carries
  `purchaseData: {purpose, ref}`: thirdweb only ever sees the reference, and nothing reaches the chain.
- The input is not inside a `<form>`, so Google Analytics form tracking never sees it.

## Confirmation, matching and alert
- thirdweb calls `POST https://hiraia.org/api/donations/webhook` (Dashboard → project → Bridge →
  Webhooks). Requests must carry thirdweb's HMAC-SHA256 signature over `${x-timestamp}.${body}`
  with the webhook secret in `THIRDWEB_WEBHOOK_SECRET`, within ±300 s. Without the secret the endpoint
  answers 503 and processes nothing. The scheme is cross-checked against the SDK's `Bridge.Webhook.parse`
  in the test.
- Only `pay.onchain-transaction` v2, `COMPLETED`, receiver = the donation address, `purpose` =
  `hiraia-donation`, and a token on the accepted list are recorded in `donations` (deduplicated by
  `paymentId`). A matching `ref` copies the email in and deletes the session.
- Every newly recorded payment alerts Luis: Beaniebot's alert thread
  (`POST https://beanie.cryptoday.live/api/alerts/push`, `BEANIEBOT_ALERT_KEY`, optional
  `BEANIEBOT_ALERT_URL`); if no key is set or Beaniebot fails, an email via Resend
  (`RESEND_API_KEY`, to `DONATION_NOTIFY_TO` → `FEEDBACK_TO` → lb@hiraia.org). Three lines:
  `Donation: 25 USDT on Ethereum` / `From: <email or anonymous>` / `Tx: <explorer link>`.
  The result is stored in `donations.notified`. A signed payload with `purchaseData.test = true` is
  labelled `TEST —`.
- Scope: thirdweb checkout payments only. Direct transfers to the raw address never pass thirdweb.

## Retention
Unmatched sessions are deleted after 7 days. Emails on confirmed donations are cleared after 180 days,
leaving an anonymous row. Purges run on every session, webhook and report request.

## Viewing
`GET https://hiraia.org/api/donations/report` uses HTTP Basic auth (any username; the password whose
SHA-256 is `DONATIONS_REPORT_PASSWORD_SHA256`). It shows a table of confirmed checkout donations
(identified and anonymous), the number of email sessions still awaiting payment, and `?format=csv`.
Emails in it are HTML-escaped.

## Production settings (`/root/hiraia/packages/web/.env.local`, mode 600, git-ignored)
`THIRDWEB_WEBHOOK_SECRET`, `DONATIONS_REPORT_PASSWORD_SHA256`, optional `BEANIEBOT_ALERT_KEY`,
plus the existing `RESEND_API_KEY` and `FEEDBACK_TO`. Restart `hiraia-web` after changing them.
The report password's plaintext pickup file is `/root/hiraia-donations-secrets/report-password`.

## Tests
`node --conditions=react-server --import tsx src/app/api/donations/donations.test.ts`
