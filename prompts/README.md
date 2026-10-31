# BridgeToGrowth-Learning: MVP build prompts

One prompt = one fresh agent session = one commit. Run them in order. Don't start prompt N+1 until prompt N's VERIFY passes.
P00 writes `CLAUDE.md`, so every later session inherits the conventions automatically.

```
claude "$(cat prompts/03-auth.md)"
```

## Prompt template (declarative: say what must be true, not how to do it)
| key | meaning |
|---|---|
| GOAL | end state, one sentence |
| GIVEN | what already exists (from earlier prompts) |
| DELIVER | files that must exist afterward |
| CONTRACT | interfaces that must hold exactly (routes, types, signatures) |
| INV | invariants: security and complexity properties that must hold |
| TESTS | the only tests to write. The count is a hard maximum |
| VERIFY | commands or checks whose success means done |
| NO | out of scope. Don't build it |

## Order and dependencies
| # | prompt | needs | parallel lane |
|---|---|---|---|
| 00 | bootstrap, conventions, server skeleton | none | A |
| 01 | local Postgres, schema, migrations | 00 | A |
| 02 | Cloudflare Tunnel and edge | 00 | B (with 01) |
| 03 | auth | 01 | A |
| 04 | billing and entitlement (Stripe, trial) | 03 | A |
| 05 | LLM gateway (OpenRouter, quota, usage) | 04 | A |
| 06 | literature grounding (OpenAlex) | 01 | B (with 03–05) |
| 07 | learning core (settings, SM-2, attempts) | 05 | A |
| 08 | question generation and style mimic uploads | 06, 07 | A |
| 09 | teach canvas backend | 06, 07 | B (with 08) |
| 10 | stats, graph, insights API | 07 | C (with 08/09) |
| 11 | web shell, seasonal theme, auth pages | 03 | D (after 03) |
| 12 | teach canvas and practice UI | 08, 09, 11 | A |
| 13 | knowledge graph and stats UI | 10, 11 | B |
| 14 | settings, billing, usage, cancel UI | 05, 11 | C |
| 15 | CI, hardening, backups | all | A |

## Locked decisions (don't re-litigate them inside the prompts)
- **Runtime:** Bun only. `Bun.serve` routes, `Bun.sql`, `Bun.password` and `bun test`. No Express, Hono, ORM, Vite or Jest.
- **Single process** bound to `127.0.0.1`. Cloudflare Tunnel is the only ingress, and Postgres listens on localhost only.
- **Payments:** Stripe Checkout and the Billing Portal. Webhooks re-fetch the subscription, so the outcome doesn't depend on event order.
- **Free trial:** handled in the app (`trial_ends_at`, no card, low USD cap). Stripe only handles paid plans.
- **Usage limits:** a monthly USD-micros cap per plan, enforced by an atomic reserve-then-settle on every LLM call.
- **Grounding:** OpenAlex, which is free and needs no key. Results are filtered to peer-reviewed journal articles with abstracts that aren't retracted. Citations the model invents are stripped on the server.
- **Spaced repetition:** SM-2, with confidence mapped to quality so confident errors get the shortest interval. Active recall uses an MCQ or free-response question plus a confidence slider. Bite-sized learning uses N steps per lesson with a word cap. Regular practice uses a daily goal and a streak. All of these are user settings.
- **Style mimic:** an uploaded PDF or PNG is checked by magic bytes, sent once to a vision model, and turned into a JSON "style profile". The raw file is never stored.
- **Season:** Cloudflare `cf-iplatitude` gives the hemisphere, and the UTC month gives the season. A user override is available in settings.

## Deferred (not in the MVP)
Email verification (needs an email provider), dictation, FSRS, OAuth, running more than one instance (the in-memory rate limiter assumes one process) and admin UI.

## Test budget
20 tests in total. CI is 1 workflow with 1 job (typecheck and `bun test`). There are no E2E tests in CI; UI prompts are verified by hand.

| prompt | tests |
|---|---|
| 00 | 1 |
| 03 | 3 |
| 04 | 3 |
| 05 | 3 |
| 06 | 2 |
| 07 | 3 |
| 08 | 1 |
| 09 | 2 |
| 10 | 1 |
| 11 | 1 |
| others | 0 |
