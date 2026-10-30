# P11 · Web shell, seasonal theming, auth pages

GOAL: A React SPA with a typed API client, guarded routes, login and signup with Turnstile, and a theme whose colours and background art follow the season at the user's location (with a settings override), matching `Example-UI/*.jpg`.

GIVEN: P03 (auth and `/api/config`) and P07 (settings). Look at every image in `Example-UI/` before writing CSS.

DELIVER: `src/shared/season.ts`, `GET /api/season` in `src/server/season/routes.ts`, and `src/web/{main.tsx,api.ts,sse.ts,router.tsx,theme.css,components/{AppShell,SeasonArt,Md,Panel,Button,Slider,Spinner}.tsx,pages/{Login,Signup}.tsx}`.

CONTRACT:
```ts
// src/shared/season.ts (pure, O(1))
export type Season = "spring"|"summer"|"fall"|"winter";
export function hemisphereOf(lat: string|null, country: string|null): { h: "N"|"S"; source: "lat"|"country"|"default" };
//   finite lat → sign; else country ∈ {AR,AU,BO,BR,BW,CL,LS,MG,MZ,NA,NZ,PY,SZ,UY,ZA,ZW} → S; else N/default
export function seasonOf(month0: number, h: "N"|"S"): Season; // N: Mar–May spring, Jun–Aug summer, Sep–Nov fall, Dec–Feb winter; S: shifted by 6 months
// GET /api/season (public) → {season, hemisphere, source}   reads cf-iplatitude, cf-ipcountry; UTC month
// src/web/api.ts
export function api<T>(path: string, schema: z.ZodType<T>, init?: {method; body}): Promise<T>; // same-origin credentials, JSON, throws ApiError{status, code: ErrorCode}
// src/web/sse.ts
export function streamSse(path: string, body: unknown, on: (e: SseEvent) => void, signal: AbortSignal): Promise<void>; // fetch + ReadableStream reader, reuses parseSseChunk from shared
```
(Move `parseSseChunk` into `src/shared/sse.ts` so the server and web share it.)

Theme:
- `<html data-season>`. The value is `settings.season` if it isn't `auto`, otherwise `/api/season`.
- `theme.css` uses a Tailwind v4 `@theme` with CSS variables `--bg --panel --panel-2 --border --text --muted --accent --accent-soft --accent-2`, overridden per `[data-season]`. The base is dark in every season (see the mockups):
  - spring: green accent, from `5CGzr.jpg` and `Sldul.jpg`
  - summer: blue accent with a yellow `--accent-2`, from `CG0tD.jpg` and `Aysvr.jpg`
  - fall: orange accent, from `DrsBE.jpg` and `3wngP.jpg`
  - winter: icy-blue accent with a white `--accent-2`, from `hraFq.jpg` and `zYRyk.jpg`
- Components use only these variables. No hard-coded colours outside `theme.css`.
- `SeasonArt` is inline SVG corner ornaments with `position: fixed`, `pointer-events: none` and `aria-hidden`. Spring has flowers bottom-right and a vine top-left; summer has suns in the top corners; fall has leaf sprigs in the corners; winter has snowflakes in the corners. Animation (gentle sway or drift only) runs only under `prefers-reduced-motion: no-preference`. No external assets.
- `AppShell` (see `5CGzr.jpg`): a left rail containing the BridgeToGrowth logo; nav links Teach, Practice, Graph, Stats, Settings, Billing; and a "Today's progress" card (dailyGoal done/target from `/api/stats?days=7`). Main content beside it. Rounded panels with 1px `--border`.
- Routes (wouter):
  - Public: `/login`, `/signup`.
  - Everything else requires `/api/me`; a 401 redirects to `/login`.
  - If `entitlement.plan === "none"`, every route except `/billing*`, `/usage` and `/settings` redirects to `/billing`.
  - Pages from P12–P14 are placeholders for now.
- `Md` uses `react-markdown`, `remark-math`, `rehype-katex` and KaTeX CSS. It must not use `rehype-raw` or `dangerouslySetInnerHTML`. It renders no images. Links render only for `http:` and `https:` URLs, with `target=_blank rel="noopener noreferrer"`.
- Login and signup: email and password fields, plus a Turnstile widget rendered explicitly from `/api/config`. Errors map from `ErrorCode` to short messages. Show a password-length hint (≥12).

INV:
- The web bundle never contains secrets; `/api/config` exposes only the site key.
- Theme switching is O(1) (one attribute change) with no layout reflow of the content.

TESTS (max 1):
1. A `seasonOf` table for all 12 months × N/S, plus `hemisphereOf` for lat `"-33.9"` → S/lat, `(null,"NZ")` → S/country, `(null,null)` → N/default, and `("abc","US")` → N/country.

VERIFY: `bun test`. Then, manually: sign up and log in with the Turnstile test keys. Switch `settings.season` through all four values with `PUT /api/settings`, and confirm each matches its mockup's palette and ornaments. Through the tunnel, `/api/season` returns `source: "lat"`.

NO: light mode, i18n, a component library, animations beyond the ornaments.
