# DigitalOcean Droplet, Caddy, and managed Postgres

Replace `$HOST` with the public hostname, for example `learn.example.com`. The app does not call the DigitalOcean API.

## 1. Droplet and firewall

One Ubuntu Droplet with more than 8 GB of RAM. Attach a DigitalOcean Cloud Firewall that allows inbound TCP 22, 80, and 443 only.

Install `postgresql-client` on the Droplet so the nightly backup can run `pg_dump` against the managed database.

Caddy is the only public HTTP ingress. The app listens on `127.0.0.1` and is not reachable from the network.

## 2. Managed Postgres

One Managed Postgres 16 or newer. Its only trusted source is the Droplet.

`DATABASE_URL` is that cluster's URI and includes `sslmode=require`. The URI's user can run the existing migrations, including `CREATE EXTENSION citext`.

## 3. DNS

An A record for `$HOST` points at the Droplet. The record is not proxied by Cloudflare.

## 4. Environment

`/etc/btg/btg.env` (root, mode 0600) sets:

- `NODE_ENV=production`
- `APP_ORIGIN=https://$HOST`
- the managed `DATABASE_URL`
- live Stripe keys
- Turnstile keys for `$HOST`
- the plan values (`FREE_CAP_USD`, `PRO_CAP_USD`, `PRO_PRICE_USD`, `FREE_LESSON_TTL_DAYS`)

The app refuses to start in production with a non-https `APP_ORIGIN` or with Turnstile test keys.

## 5. Install order

1. Fill in `/etc/btg/btg.env`.
2. `sudo BUN="$(command -v bun)" deploy/install.sh`
3. `sudo deploy/setup-proxy.sh $HOST`

`deploy/install.sh` syncs the checkout to `/opt/btg`, builds, migrates, installs the systemd units, and waits for `/api/health`. The first run creates the env file from `.env.example` and stops so you can fill it in. Rerun it for every update.

`deploy/setup-proxy.sh` installs Caddy when it is missing, renders `deploy/Caddyfile.tmpl`, and reloads Caddy. HTTP redirects to HTTPS. The certificate is a Let's Encrypt certificate for `$HOST`. Caddy reverse-proxies to `http://127.0.0.1:$PORT` and overwrites `X-Real-IP` with the TCP peer.

## 6. Turnstile

Create a managed Turnstile widget whose hostname is `$HOST`. The DNS zone is not a Cloudflare zone. Copy the site key into `TURNSTILE_SITE_KEY` and the secret into `TURNSTILE_SECRET`. Never commit them.

## 7. Stripe

Webhook endpoint `https://$HOST/api/stripe/webhook`. Events: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.

The customer portal return URL is `$HOST`.

`bun --env-file=/etc/btg/btg.env scripts/stripe-setup.ts https://$HOST` creates or reuses the Pro price and that webhook. Put the printed `STRIPE_PRICE_ID` and `STRIPE_WEBHOOK_SECRET` in the env file. Stripe charges the `STRIPE_PRICE_ID` amount, so keep it equal to `PRO_PRICE_USD`. Restart with `sudo systemctl restart btg`.

## 8. OpenRouter

The app caps each account's monthly AI spend. Set a credit limit on the API key as a second guard: OpenRouter → Keys → your key → Credit limit.

## 9. What the edge does not do

Login is limited to 10 requests a minute per IP, and signup to 5, inside the app. There is no second edge limiter. The app sets the response security headers. Do not put Cloudflare in front of the A record.
