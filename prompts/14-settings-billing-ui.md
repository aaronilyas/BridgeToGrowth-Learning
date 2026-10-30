# P14 · Settings, Billing, Usage limit and Cancel subscription pages

GOAL: Users can configure their learning behaviour, subscribe, see and understand their usage cap, manage payment, and cancel or resume, all with explicit and safe flows.

GIVEN: P04 (billing API), P05 (`/api/usage`, `/api/models`), P07 (settings) and P11.

DELIVER: `src/web/pages/{Settings,Billing,Usage,Cancel}.tsx` and `src/web/components/{UsageMeter,PlanCard}.tsx`.

CONTRACT:
- `/settings`: the form is derived from the `Settings` zod schema, grouped into Spaced repetition, Active recall, Bite-sized learning, Daily practice, Model and Appearance (season override + level). Number inputs and sliders use the schema's min and max. Saving sends `PUT /api/settings` with changed keys only. Changing the season applies `data-season` immediately. The model `<select>` comes from `/api/models`.
- `/billing`: `PlanCard` shows one of:
  - trial: "N days left", the cap, and a Subscribe button
  - pro: "Renews {date}", or "Ends {date}" when `cancelAtPeriodEnd`
  - none: "Trial ended" and a Subscribe button
  
  Subscribe posts to checkout, and the client navigates only if the URL starts with `https://checkout.stripe.com/`. Manage payment opens the portal, only for URLs starting with `https://billing.stripe.com/`. With `?ok=1`, poll `/api/billing` once a second, up to 10 times, until plan is `pro`, then show a success toast. Links: Usage, Cancel subscription (pro only).
- `/usage`: `UsageMeter` shows used, plus reserved hatched, over the cap. It turns `--accent-2` at ≥80% and red at 100%. Also shown: the period reset date (the 1st of next month, UTC), cost by model, and a table of the last 20 calls (kind, model, cost as $ to 4 decimal places, time). On a trial, show an upgrade CTA. Money is shown via `micros / 1e6` formatted with `Intl.NumberFormat`.
- `/billing/cancel` (pro and not already canceling):
  - Content: what stops on `{periodEnd}` and what is kept (graph, stats, history).
  - A required "I understand" checkbox, then Confirm, which POSTs to `/api/billing/cancel`.
  - Afterwards, show "Access until {date}" and a Resume button (`/api/billing/resume`).
  - If already canceling, the page shows the Resume state directly.
- Global: `quota_exceeded` anywhere shows a dismissible banner, "Monthly AI limit reached — resets {date}", linking to `/usage`.

INV:
- The client only displays entitlement. It never gates anything by itself beyond navigation; the server enforces.
- Redirect URLs are prefix-checked against Stripe origins before `location.assign`.

TESTS: none (manual).

VERIFY (Stripe test mode, `stripe listen` running):
1. As a trial user, `/usage` shows the cap.
2. Subscribe with card 4242 and confirm the `?ok=1` poll flips to pro.
3. Cancel, then confirm "Ends {date}".
4. Resume, then confirm "Renews {date}".
5. Set `PRO_CAP_USD=0.0001`, make one LLM call and confirm the banner appears and `/usage` is red.
6. Change settings, reload, and confirm they persist and `bite.stepsPerLesson` affects the next lesson.

NO: invoices list (the Portal covers it), plan comparison page, coupons.
