# BridgeToGrowth Learning

BridgeToGrowth Learning is an AI-assisted learning app with grounded lessons, active recall, spaced repetition, and progress insights.
It uses OpenAlex for research sources, OpenRouter for lesson and chat generation, Stripe for the Pro subscription, and a Cloudflare Tunnel to serve a local machine on a public domain.

## Plans

| | Free | Pro |
|---|---|---|
| Price | $0 | `PRO_PRICE_USD` a month (9.99) |
| Monthly AI usage | `FREE_CAP_USD` (0.20) | `PRO_CAP_USD` (5.99) |
| Lessons | deleted `FREE_LESSON_TTL_DAYS` (7) days after creation | kept |
| Settings and model choice | defaults only | configurable |
| Personal stats and insights | no | yes |

All four values come from the environment (see `.env.example`); nothing is hard-coded. Usage is the OpenRouter cost of each call, reserved before the call and settled at the reported cost, and resets on the 1st of each month (UTC). A subscription that is `active`, `trialing` or `past_due` counts as Pro. When a user upgrades, their pending lesson deletions are cancelled. When Pro ends, lessons made during Pro are kept, stored settings are kept but not applied, and stats are locked.

## Prerequisites

- Bun 1.2 or newer
- PostgreSQL 16 or newer
- A Stripe account; the Stripe CLI for local webhook testing
- For production: a domain on Cloudflare and `cloudflared`, `jq`, `envsubst` (gettext), `rsync` on the app machine
- poppler-utils (`pdftotext`) and Ghostscript (`gs`) for lesson PDF attachments; `prlimit` (util-linux) is used to cap their resources when present
- bubblewrap (`bwrap`), `prlimit` and a system Python at `/usr/bin/python3` for sandboxed code exercises. Optional libraries such as numpy, sympy, scipy and mpmath are offered only if installed for that interpreter (for example `pacman -S python-numpy python-sympy`)

## Local setup

1. Create the local role and databases: `scripts/db-setup.sh '<btg-role-password>'`.
2. Create `.env` from `.env.example`. Set the database URLs, `OPENROUTER_API_KEY` and `STRIPE_SECRET_KEY` (test mode). The Turnstile test keys in the example work locally. Keep `.env` out of version control.
3. Apply migrations: `bun run migrate` and `bun run migrate "$TEST_DATABASE_URL"`.
4. Create the Pro price: `bun scripts/stripe-setup.ts`. Put the printed `STRIPE_PRICE_ID` in `.env`.
5. Forward webhooks: `stripe listen --forward-to localhost:3000/api/stripe/webhook`. Put the printed `whsec_…` in `STRIPE_WEBHOOK_SECRET`.
6. Start the app with `bun run dev` and open http://localhost:3000. Use `localhost`, not `127.0.0.1`: the session cookie is `Secure`, and browsers only accept that over plain http on `localhost`. Test card: `4242 4242 4242 4242`.

Upgrading from the single-user version: the old local profile (`local@localhost`) still owns your lessons and history. Claim it as a real account with `bun scripts/set-password.ts you@example.com --claim-local`. The script asks for the new password.

## Production on this machine

The app runs as the `btg` system user from `/opt/btg`, bound to `127.0.0.1`. `cloudflared` is the only ingress.

1. `sudo BUN="$(command -v bun)" deploy/install.sh`. The first run creates `/etc/btg/btg.env` (root, 0600) and stops.
2. Fill in `/etc/btg/btg.env`: `NODE_ENV=production`, `APP_ORIGIN=https://<your-host>`, the production `DATABASE_URL`, live Stripe keys, Turnstile keys for your hostname, and the plan values. The app refuses to start in production with a non-https origin or Turnstile test keys.
3. Run `deploy/install.sh` again. It syncs the checkout to `/opt/btg`, builds, migrates, installs the systemd units and waits for `/api/health`. Rerun it for every update.
4. `sudo deploy/setup-tunnel.sh <your-host>` (once) creates the tunnel, the DNS record and the `cloudflared` service.
5. Work through [deploy/cloudflare-dashboard.md](deploy/cloudflare-dashboard.md): TLS, security headers, WAF rate limit, Turnstile, the Stripe product, webhook and customer portal, and an OpenRouter credit limit.

Signed-in users change their password on the Account page. That signs out every other session. The same page deletes the account: lessons, practice history and settings are removed, and a Pro subscription is canceled immediately so it cannot renew.

Set `RESEND_API_KEY` and `MAIL_FROM` (for example `BridgeToGrowth <learn@your-host>`) to email a one-hour, one-time reset link from the sign-in page. Without those, a forgotten password stays operator-assisted: `sudo bun --env-file=/etc/btg/btg.env /opt/btg/scripts/set-password.ts <email>`.

Lessons and chat let you choose DeepSeek V4.1 Flash (`deepseek/deepseek-v4.1-flash`), GLM-5.3-Flash (`z-ai/glm-5.3-flash`), or GPT-6-Luna (`openai/gpt-6-luna`). `.env.example` sets `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1`. Requests go to `${OPENROUTER_BASE_URL}/chat/completions`. `OPENROUTER_REASONING_LEVEL` (`low`, `high`, or `max`) is sent as the same reasoning effort for all three. Grading, extraction, and insights still use `OPENROUTER_MODEL`.

Lessons accept up to 3 PDFs (25 MB each) and 3 http(s) links as extra context. They are read once for the planning call and never stored; the plan keeps only short per-step notes in the model's words, which are used to write later steps and are never returned to the browser. Text-layer PDFs are reduced to capped plain text locally. Image-only PDFs are cut to 10 pages and compressed with Ghostscript before upload. Links are fetched only from public addresses on default ports, with every redirect re-checked.

For programming and computational topics, the free-response question in a practice set can be a Python code exercise. Each one lists the libraries baked into it. The learner can import only those, and nothing can be installed. Code runs in a bubblewrap sandbox: no network, read-only `/usr` as its only host directory, a private 8 MB `/tmp`, no `/home`, `/etc` or `/proc`, all capabilities dropped and nested user namespaces disabled. `prlimit` caps it at 1 GB of memory and 5 s of CPU, with a 10 s wall-clock limit. Inside the sandbox, a policy layer rejects imports, dunder attributes and introspection built-ins outside the question's allowlist. Hidden tests grade each submission. A generated exercise is stored only if its reference solution passes those tests. If the sandbox can't start, code exercises are turned off and the server logs why.

## Operating notes

- The `btg-backup.timer` systemd unit runs nightly at 03:30 local time. It writes mode 0600 dumps under `/var/backups/btg` and removes dumps older than 14 days. Restore with `createdb btg_restore_check && pg_restore -d btg_restore_check /var/backups/btg/btg-YYYY-MM-DD.dump`.
- Rotate secrets in `/etc/btg/btg.env`, then restart `btg.service`. Never commit `.env` or production credentials.
- Background sweeps run inside the app: expired sessions and password-reset links hourly, expired free-plan lessons every 15 minutes, and Stripe event ids older than 30 days daily.
- If a webhook is missed, returning from Checkout calls `POST /api/billing/sync`, which reads the subscription straight from Stripe.
- Selectable models are DeepSeek V4.1 Flash, GLM-5.3-Flash, and GPT-6-Luna. `OPENROUTER_REASONING_LEVEL` sets their shared reasoning effort. `OPENROUTER_MODEL` is only for server-side grading, extraction, and insights.
