# Cloudflare and Stripe dashboard checklist

Replace `$HOST` with the public hostname (for example `app.example.com`). Labels follow the dashboard as of P02; if a label has moved, search for the setting name.

## 1. SSL/TLS

1. Zone `$HOST` → **SSL/TLS** → **Edge Certificates**.
2. **Always Use HTTPS**: On.
3. **HTTP Strict Transport Security (HSTS)** → Enable: max-age `15552000`, **Include subdomains**: On. Leave **Preload** off.
4. **Minimum TLS Version**: `TLS 1.2`.

## 2. Visitor location headers

1. Zone `$HOST` → **Rules** → **Managed Transforms**.
2. Turn on **Add visitor location headers**. P11 reads `cf-iplatitude` and `cf-ipcountry`.

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

## 4. Rate limiting for auth

1. Zone `$HOST` → **Security** → **WAF** → **Rate limiting rules** → **Create rule**.
2. Name: `btg auth login rate`.
3. Expression: `starts_with(http.request.uri.path, "/api/auth/")`.
4. Characteristics: **IP**. Rate: **10** requests per **1 minute**.
5. Action: **Block**, duration **10 minutes**.

## 5. Cache bypass for the API

1. Zone `$HOST` → **Caching** → **Cache Rules** → **Create rule**.
2. Name: `btg api bypass`. Expression: `starts_with(http.request.uri.path, "/api/")`.
3. Cache eligibility: **Bypass cache**.

## 6. Turnstile

1. Account → **Turnstile** → **Add widget**.
2. Widget name: `btg`. Hostname: `$HOST`. Widget mode: **Managed**.
3. Copy the **Site key** into `TURNSTILE_SITE_KEY` and the **Secret key** into `TURNSTILE_SECRET` in `/etc/btg/btg.env`. Never commit them.

## 7. Do not enable Bot Fight Mode

Zone `$HOST` → **Security** → **Bots**: leave **Bot Fight Mode** off. It can't be bypassed on the free plan and it blocks Stripe webhook deliveries.

## 8. Stripe webhook

1. Stripe dashboard → **Developers** → **Webhooks** → **Add endpoint**.
2. Endpoint URL: `https://$HOST/api/stripe/webhook`.
3. Events: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.
4. Copy the **Signing secret** into `STRIPE_WEBHOOK_SECRET` in `/etc/btg/btg.env`.
