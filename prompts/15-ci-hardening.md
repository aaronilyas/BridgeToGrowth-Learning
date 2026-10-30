# P15 · Minimal CI, security pass, backups, README

GOAL: One CI job keeps the repo green. A grep-verifiable security sweep finds no violations of `CLAUDE.md`. The local Postgres is backed up nightly, and the README lets an operator deploy.

GIVEN: P00–P14.

DELIVER:
- `.github/workflows/ci.yml`: one workflow with one job.
  - Triggers: `pull_request` and `push` to `main`. `permissions: contents: read`.
  - Service: `postgres:17`, with `TEST_DATABASE_URL` and dummy values for the other env vars.
  - Steps: checkout and `oven-sh/setup-bun`, both pinned by commit SHA; `bun install --frozen-lockfile`; `bun run migrate $TEST_DATABASE_URL`; `bun run typecheck`; `bun test`. No matrix, no caching tricks, no other workflows.
- `deploy/systemd/btg-backup.{service,timer}`: run nightly at 03:30 local. `pg_dump -Fc btg > /var/backups/btg/btg-$(date +%F).dump`, owned by `btg` with mode 0600, deleting dumps older than 14 days. Restore command in the README.
- `README.md`: what the app is (2 lines); prerequisites (Bun, Postgres ≥16, cloudflared, Stripe CLI); setup in order (db-setup, then `.env`, migrate, dev, then tunnel via P02); operating notes (backups, rotating secrets, editing `MODELS`). At most 80 lines.
- Fix every finding from the sweep below in place.

SWEEP (each item is a command or check with an expected result; record it in the commit body):
| check | expected |
|---|---|
| `git grep -n "sql.unsafe"` | only `scripts/migrate.ts` |
| `git grep -nE "dangerouslySetInnerHTML\|rehype-raw\|eval\(\|new Function"` | none |
| `git grep -nE "sk_(live\|test)_[A-Za-z0-9]{8,}\|whsec_[A-Za-z0-9]{8,}\|sk-or-"` | none |
| every `route(` call with a body has a `.strict()` schema | true |
| every non-GET route has `csrf` on, except `/api/stripe/webhook` | true |
| every SQL statement touching a user-owned table has a `user_id` predicate, or a PK fetched through one | true |
| every list query has a `LIMIT` | true |
| `console.*` never logs `env`, request bodies, cookies or LLM prompts | true |
| `bun audit` | no high or critical findings, or a written justification |
| `EXPLAIN` on queue, attempt, session lookup, stats and graph queries (seeded with 10k rows) | index scans, no seq scans on user tables |

INV:
- CI has fewer than 6 steps and uses no secrets. Tests make no network calls.
- The total test count stays ≤20 (`bun test` output). Don't add tests in this prompt.

TESTS: none added.

VERIFY:
- Push a branch and confirm CI is green in under 3 minutes.
- `systemctl list-timers | grep btg-backup` shows the timer.
- Run the backup by hand, restore it into a scratch DB with `pg_restore -d btg_restore_check`, compare row counts, and drop the scratch DB.

NO: E2E or browser tests in CI, coverage gates, deploy automation, Dependabot.
