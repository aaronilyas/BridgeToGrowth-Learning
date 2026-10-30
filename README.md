# BridgeToGrowth Learning

BridgeToGrowth Learning is an AI-assisted learning app with grounded lessons, active recall, spaced repetition, and progress insights.
It uses OpenAlex for research sources and OpenRouter for lesson and chat generation.

## Prerequisites

- Bun 1.2 or newer
- PostgreSQL 16 or newer
- `cloudflared`
- Stripe CLI

## Local setup

1. Create the local role and databases: `scripts/db-setup.sh '<btg-role-password>'`.
2. Create `.env` from `.env.example` and set the required local values. Keep it out of version control.
3. Apply migrations: `bun run migrate`.
4. Start the app: `bun run dev`.
5. Configure and run the Cloudflare Tunnel using [deploy/cloudflare-dashboard.md](deploy/cloudflare-dashboard.md).

## Operating notes

- The `btg-backup.timer` systemd unit runs nightly at 03:30 local time. It writes mode 0600 dumps under `/var/backups/btg` and removes dumps older than 14 days. Restore with `createdb btg_restore_check && pg_restore -d btg_restore_check /var/backups/btg/btg-YYYY-MM-DD.dump`.
- Rotate secrets in the protected environment file, then restart `btg.service`; never commit `.env` or production credentials.
- The model allowlist and plan limits live in `src/server/llm/models.ts`. Edit `MODELS` there when adding or removing supported models.
