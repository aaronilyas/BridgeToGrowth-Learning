# DigitalOcean Droplet, Caddy, and managed Postgres

Replace `$HOST` with the public hostname, for example `learn.example.com`. The app does not call the DigitalOcean API. Steps that are the same on every provider are in [common.md](common.md).

To run Postgres on the Droplet itself instead, follow [hetzner.md](hetzner.md) steps 5–10. They work on any Ubuntu 24.04 server.

## 1. Droplet and firewall

One Ubuntu 24.04 Droplet with at least 8 GB of RAM. Attach a DigitalOcean Cloud Firewall that allows inbound TCP 22, 80, and 443 only.

Install the [server packages](common.md#server-packages). `postgresql-client` lets the nightly backup run `pg_dump` against the managed database. Its major version must be at least the cluster's; `deploy/install.sh` checks.

## 2. Managed Postgres

One Managed Postgres 16 or newer. Its only trusted source is the Droplet.

`DATABASE_URL` is that cluster's URI and includes `sslmode=require`. The URI's user can run the existing migrations, including `CREATE EXTENSION citext`.

Do not run `deploy/setup-postgres.sh` in this mode.

## 3. DNS

An A record for `$HOST` points at the Droplet. The record is not proxied by Cloudflare.

## 4. Environment

Fill in `/etc/btg/btg.env` as in [common.md → Environment](common.md#environment), with the managed `DATABASE_URL`.

## 5. Install order

1. `sudo BUN="$(command -v bun)" deploy/install.sh`. The first run creates `/etc/btg/btg.env` from `.env.example` and stops.
2. Fill in `/etc/btg/btg.env`, then run `deploy/install.sh` again.
3. `sudo deploy/setup-proxy.sh $HOST`

`deploy/install.sh` checks the [sandbox](common.md#sandbox) prerequisites, syncs the checkout to `/opt/btg`, builds, migrates, installs the systemd units [sized to the Droplet](common.md#machine-sizing), and waits for `/api/health`. Rerun it for every update.

`deploy/setup-proxy.sh` installs Caddy when it is missing, renders `deploy/Caddyfile.tmpl`, and reloads Caddy. HTTP redirects to HTTPS. The certificate is a Let's Encrypt certificate for `$HOST`. Caddy reverse-proxies to `http://127.0.0.1:$PORT` and overwrites `X-Real-IP` with the TCP peer.

## 6. Shared steps

- [Sandbox](common.md#sandbox)
- [Turnstile](common.md#turnstile)
- [Stripe](common.md#stripe)
- [OpenRouter](common.md#openrouter)
- [Backups](common.md#backups)
- [What the edge does not do](common.md#what-the-edge-does-not-do)
