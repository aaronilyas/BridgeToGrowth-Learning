# Cloudflare, Stripe and OpenRouter dashboard checklist

Replace `$HOST` with the public hostname, for example `learn.example.com`. The zone that contains `$HOST` must use Cloudflare DNS. Dashboard labels move from time to time. If one has moved, search the dashboard for the setting name.

## 1. Tunnel

Run `sudo deploy/setup-tunnel.sh $HOST` once on the app machine. It creates the `btg` tunnel, adds the proxied DNS record for `$HOST`, and runs `cloudflared` as a systemd service. Then set `APP_ORIGIN=https://$HOST` in `/etc/btg/btg.env` and restart `btg.service`.

The app listens only on `127.0.0.1`. Don't open port 3000 on your router or firewall. The tunnel is the only way in, and the app trusts `cf-connecting-ip` for rate limits only because of that.

## 2. SSL/TLS

1. Zone `$HOST` → **SSL/TLS** → **Edge Certificates**.
2. **Always Use HTTPS**: On.
3. **HTTP Strict Transport Security (HSTS)** → Enable: max-age `15552000`, **Include subdomains**: On. Leave **Preload** off.
4. **Minimum TLS Version**: `TLS 1.2`.

## 3. Response security headers

1. Zone `$HOST` → **Rules** → **Transform Rules** → **Modify Response Header** → **Create rule**.
2. Name: `btg security headers`. Custom filter expression: **All incoming requests** (`true`).
3. Add each row under **Set static**, with the exact name and value:

| Header name | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |

Stripe Checkout and the billing portal are full-page redirects, so they need no CSP entries.

## 4. Rate limiting for sign-in

1. Zone `$HOST` → **Security** → **WAF** → **Rate limiting rules** → **Create rule**.
2. Name: `btg auth rate`.
3. Expression: `starts_with(http.request.uri.path, "/api/auth/")`.
4. Characteristics: **IP**. Rate: **10** requests per **1 minute**.
5. Action: **Block**, duration **10 minutes**.

The app also rate-limits sign-up, sign-in and every AI route on its own.

## 5. Cache bypass for the API

1. Zone `$HOST` → **Caching** → **Cache Rules** → **Create rule**.
2. Name: `btg api bypass`. Expression: `starts_with(http.request.uri.path, "/api/")`.
3. Cache eligibility: **Bypass cache**.

## 6. Turnstile

1. Account → **Turnstile** → **Add widget**.
2. Widget name: `btg`. Hostname: `$HOST`. Widget mode: **Managed**.
3. Copy the **Site key** into `TURNSTILE_SITE_KEY` and the **Secret key** into `TURNSTILE_SECRET` in `/etc/btg/btg.env`. Never commit them. In production the app refuses to start with Cloudflare's test keys.

## 7. Leave Bot Fight Mode off

Zone `$HOST` → **Security** → **Bots**: leave **Bot Fight Mode** off. On the free plan it can't be bypassed, and it blocks Stripe webhook deliveries.

## 8. Stripe

Do this in test mode first, then repeat it in live mode with the live keys.

1. **Product and price.** Run `bun --env-file=/etc/btg/btg.env scripts/stripe-setup.ts https://$HOST` from the checkout. It creates (or reuses) the `BridgeToGrowth Pro` product, a monthly price of `PRO_PRICE_USD`, and the webhook endpoint below. It prints `STRIPE_PRICE_ID` and, the first time, `STRIPE_WEBHOOK_SECRET`. To do it by hand instead:
   - **Product catalog** → **Add product** → name `BridgeToGrowth Pro`, **Recurring**, **Monthly**, amount `PRO_PRICE_USD` (9.99 USD). Copy the price ID (`price_…`) into `STRIPE_PRICE_ID`.
   - **Developers** → **Webhooks** → **Add endpoint** → URL `https://$HOST/api/stripe/webhook`, events `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`. Copy the **Signing secret** into `STRIPE_WEBHOOK_SECRET`.
2. **Customer portal.** **Settings** → **Billing** → **Customer portal** → turn on: update payment methods, view invoices, cancel subscriptions (at end of billing period). Save. The **Manage payment** button fails until the portal is saved once.
3. **Secret key.** **Developers** → **API keys**. Put the secret key, or a restricted key with write access to Customers, Checkout Sessions, Subscriptions and Customer portal, into `STRIPE_SECRET_KEY`.
4. Restart: `sudo systemctl restart btg`.

Every price shown in the app comes from `PRO_PRICE_USD`. Stripe charges whatever the `STRIPE_PRICE_ID` price says, so keep the two in step.

## 9. OpenRouter spending backstop

The app caps each account's monthly AI spend (`FREE_CAP_USD`, `PRO_CAP_USD`). As a second guard against abuse such as mass free sign-ups, set a credit limit on the API key: OpenRouter → **Keys** → your key → **Credit limit**.
