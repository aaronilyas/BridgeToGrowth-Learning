# Shared production steps

These steps are the same on every provider. [hetzner.md](hetzner.md) and [digitalocean.md](digitalocean.md) link here.

Replace `$HOST` with the public hostname, for example `learn.example.com`.

## Server packages

```sh
sudo apt update
sudo apt install -y git rsync curl unzip bubblewrap util-linux python3 poppler-utils ghostscript postgresql-client
```

`deploy/install.sh` checks for these and prints one `apt install` line for anything missing. When Postgres runs on the same server, `deploy/setup-postgres.sh` installs the server and a matching `pg_dump`.

## Environment

`/etc/btg/btg.env` is owned by root with mode 0600. Edit it with `sudo nano /etc/btg/btg.env`.

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` (the install scripts set it) |
| `APP_ORIGIN` | `https://$HOST` |
| `DATABASE_URL` | Local database: written by `deploy/setup-postgres.sh`, leave it alone. Managed database: the cluster's URI including `sslmode=require` |
| `OPENROUTER_API_KEY` | your OpenRouter key ([OpenRouter](#openrouter)) |
| `OPENALEX_MAILTO` | an email address OpenAlex can contact |
| `STRIPE_SECRET_KEY` | live key, `sk_live_…` or a restricted `rk_live_…` |
| `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` | printed by `scripts/stripe-setup.ts` ([Stripe](#stripe)) |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` | the widget for `$HOST` ([Turnstile](#turnstile)) |
| `FREE_CAP_USD`, `PRO_CAP_USD`, `PRO_PRICE_USD`, `FREE_LESSON_TTL_DAYS` | the plan values |
| `RESEND_API_KEY`, `MAIL_FROM` | optional pair for password-reset email |
| `ADSENSE_CLIENT`, `ADSENSE_SLOT` | optional pair for free-plan ads |

The app refuses to start in production with a non-https `APP_ORIGIN` or with Turnstile test keys. Never print the file, paste it anywhere, or commit it.

## Sandbox

Code exercises and PDF reading run in bubblewrap, under prlimit, inside a per-run cgroup. The server must use cgroup v2 (the Ubuntu default).

`deploy/install.sh` checks this before it builds:

- It runs a trivial `bwrap` as the `btg` user. Ubuntu 24.04 sets `kernel.apparmor_restrict_unprivileged_userns=1`, which blocks it. In that case the script installs `/etc/apparmor.d/btg-bwrap`, a profile that grants user namespaces to `/usr/bin/bwrap` only, and tries again. The sysctl stays on for every other program.
- It warns if the sandbox still cannot start, or if `/sys/fs/cgroup` is not cgroup v2. The app then still runs, but code exercises and PDF attachments are reported as unavailable.

`btg.service` sets `Delegate=yes`. At boot the server moves itself into `/sys/fs/cgroup/system.slice/btg.service/main` and creates `.../sandbox`. Each run gets a leaf under `sandbox/` with `pids.max=64`, `memory.max=1G` (512M for code), `memory.swap.max=0`, and `cpu.max` of one core. The leaf is killed through `cgroup.kill` on timeout and removed after exit.

If the setup fails, the log says `sandbox: cgroup setup failed` and code exercises and PDF attachments are reported as unavailable. They never run without the cgroup.

Check it after install:

- `systemd-cgls -u btg.service` shows the server under `main/` and an empty `sandbox/`.
- `systemctl status btg` shows the task count. It returns to its idle value after a run.

## Machine sizing

`deploy/install.sh` writes `/etc/systemd/system/btg.service.d/size.conf` on every run:

- `CPUQuota` is 80% of each core (`nproc` × 80%).
- `MemoryMax` is total RAM minus 1.5 GB for the OS and Caddy. When Postgres runs on the same server, it also subtracts 25% of RAM for Postgres. It never goes below 2G.

It refuses to install on less than 4 GB of RAM, because one sandbox run alone may use 1G. Rerun it after resizing the server.

## Backups

`btg-backup.timer` runs `deploy/backup.sh` nightly at 03:30. It runs `pg_dump -Fc` against `DATABASE_URL`, writes mode 0600 dumps under `/var/backups/btg`, and removes dumps older than 14 days. `deploy/install.sh` stops if the installed `pg_dump` is older than the database server, since the dump would fail.

With a local database, the dumps sit on the same disk as the database. A lost server loses both. Turn on your provider's server backups, or copy `/var/backups/btg` to another machine regularly.

Restore with `pg_restore -d "$DATABASE_URL" /var/backups/btg/btg-YYYY-MM-DD.dump`.

## Turnstile

In the Cloudflare dashboard, create a managed Turnstile widget whose hostname is `$HOST`. The DNS zone does not have to be a Cloudflare zone. Copy the site key into `TURNSTILE_SITE_KEY` and the secret into `TURNSTILE_SECRET`. Never commit them.

## Stripe

Webhook endpoint `https://$HOST/api/stripe/webhook`. Events: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.

The customer portal return URL is `$HOST`.

```sh
cd /opt/btg
sudo bun --env-file=/etc/btg/btg.env scripts/stripe-setup.ts https://$HOST
```

This creates or reuses the Pro price and that webhook. Put the printed `STRIPE_PRICE_ID` and `STRIPE_WEBHOOK_SECRET` in the env file. Stripe charges the `STRIPE_PRICE_ID` amount, so keep it equal to `PRO_PRICE_USD`. Restart with `sudo systemctl restart btg`.

## OpenRouter

The app caps each account's monthly AI spend. Set a credit limit on the API key as a second guard: OpenRouter → Keys → your key → Credit limit.

## What the edge does not do

Caddy is the only public HTTP ingress. The app listens on `127.0.0.1` and is not reachable from the network.

Login is limited to 10 requests a minute per IP, and signup to 5, inside the app. There is no second edge limiter. The app sets the response security headers. Do not put Cloudflare's proxy in front of the A record.
