# BridgeToGrowth Learning

BridgeToGrowth Learning is an AI-assisted learning app with grounded lessons, active recall, spaced repetition, and progress insights.
It uses OpenAlex for research sources and OpenRouter for lesson and chat generation.

## Prerequisites

- Bun 1.2 or newer
- PostgreSQL 16 or newer
- poppler-utils (`pdftotext`) and Ghostscript (`gs`) for lesson PDF attachments; `prlimit` (util-linux) is used to cap their resources when present
- bubblewrap (`bwrap`), `prlimit` and a system Python at `/usr/bin/python3` for sandboxed code exercises. Optional libraries such as numpy, sympy, scipy and mpmath are offered only if installed for that interpreter (for example `pacman -S python-numpy python-sympy`)

## Local setup

1. Create the local role and databases: `scripts/db-setup.sh '<btg-role-password>'`.
2. Create `.env` from `.env.example` and set the database URL and `OPENROUTER_API_KEY`. Keep it out of version control.
3. Apply migrations: `bun run migrate`.
4. Start the app: `bun run dev`. The app is local: there is no sign-in and no payment flow.

Lessons and chat let you choose DeepSeek V4.1 Flash (`deepseek/deepseek-v4.1-flash`), GLM-5.3-Flash (`z-ai/glm-5.3-flash`), or GPT-6-Luna (`openai/gpt-6-luna`). `.env.example` sets `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1`. Requests go to `${OPENROUTER_BASE_URL}/chat/completions`. `OPENROUTER_REASONING_LEVEL` (`low`, `high`, or `max`) is sent as the same reasoning effort for all three. Grading, extraction, and insights still use `OPENROUTER_MODEL`.

Lessons accept up to 3 PDFs (25 MB each) and 3 http(s) links as extra context. They are read once for the planning call and never stored; the plan keeps only short per-step notes in the model's words, which are used to write later steps and are never returned to the browser. Text-layer PDFs are reduced to capped plain text locally. Image-only PDFs are cut to 10 pages and compressed with Ghostscript before upload. Links are fetched only from public addresses on default ports, with every redirect re-checked.

For programming and computational topics, the free-response question in a practice set can be a Python code exercise. Each one lists the libraries baked into it. The learner can import only those, and nothing can be installed. Code runs in a bubblewrap sandbox: no network, read-only `/usr` as its only host directory, a private 8 MB `/tmp`, no `/home`, `/etc` or `/proc`, all capabilities dropped and nested user namespaces disabled. `prlimit` caps it at 1 GB of memory and 5 s of CPU, with a 10 s wall-clock limit. Inside the sandbox, a policy layer rejects imports, dunder attributes and introspection built-ins outside the question's allowlist. Hidden tests grade each submission. A generated exercise is stored only if its reference solution passes those tests. If the sandbox can't start, code exercises are turned off and the server logs why.

## Operating notes

- The `btg-backup.timer` systemd unit runs nightly at 03:30 local time. It writes mode 0600 dumps under `/var/backups/btg` and removes dumps older than 14 days. Restore with `createdb btg_restore_check && pg_restore -d btg_restore_check /var/backups/btg/btg-YYYY-MM-DD.dump`.
- Rotate secrets in the protected environment file, then restart `btg.service`; never commit `.env` or production credentials.
- Selectable models are DeepSeek V4.1 Flash, GLM-5.3-Flash, and GPT-6-Luna. `OPENROUTER_REASONING_LEVEL` sets their shared reasoning effort. `OPENROUTER_MODEL` is only for server-side grading, extraction, and insights.
