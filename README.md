# BridgeToGrowth Learning

BridgeToGrowth Learning is an AI-assisted learning app with grounded lessons, active recall, spaced repetition, and progress insights.
It uses OpenAlex for research sources and OpenRouter for lesson and chat generation.

## Prerequisites

- Bun 1.2 or newer
- PostgreSQL 16 or newer

## Local setup

1. Create the local role and databases: `scripts/db-setup.sh '<btg-role-password>'`.
2. Create `.env` from `.env.example` and set the database URL and `OPENROUTER_API_KEY`. Keep it out of version control.
3. Apply migrations: `bun run migrate`.
4. Start the app: `bun run dev`. The app is local: there is no sign-in and no payment flow.

Lessons and chat use the OpenRouter Free Models Router. `.env.example` sets `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1` and `OPENROUTER_MODEL=openrouter/free`. Requests go to `${OPENROUTER_BASE_URL}/chat/completions` with that model.

## Operating notes

- The `btg-backup.timer` systemd unit runs nightly at 03:30 local time. It writes mode 0600 dumps under `/var/backups/btg` and removes dumps older than 14 days. Restore with `createdb btg_restore_check && pg_restore -d btg_restore_check /var/backups/btg/btg-YYYY-MM-DD.dump`.
- Rotate secrets in the protected environment file, then restart `btg.service`; never commit `.env` or production credentials.
- The model id comes from `OPENROUTER_MODEL`. The default is the Free Models Router, `openrouter/free`.
