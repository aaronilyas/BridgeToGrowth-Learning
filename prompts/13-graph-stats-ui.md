# P13 · Knowledge Graph and Stats pages

GOAL: `/graph` renders the user's topics and their relations as a navigable map (as in `Sldul.jpg` and `zYRyk.jpg`), and `/stats` renders the topic-independent metrics and the tutor's trend insights.

GIVEN: P10 (`/api/graph`, `/api/stats`, `/api/insights`) and P11.

DELIVER: `src/web/pages/{Graph,Stats}.tsx`, `src/web/graph/{layout.ts,GraphView.tsx,NodePanel.tsx}` and `src/web/charts/{LineChart,BarChart,StatTile}.tsx`.

CONTRACT:
- `layout.ts` (pure): `layoutGraph(nodes, edges): {x,y}[]`. Add one virtual hub node per domain, with an edge from each topic to its hub, then run `d3-force` synchronously for a fixed 300 ticks (charge, link, collide, center) and return positions. `// O(ticks·(V+E) log V)`. Run it in `useMemo` keyed by a data hash; there is no per-frame React rendering.
- `GraphView`:
  - Rendering: SVG. Hubs are large labelled circles with a domain icon glyph. A topic node's radius is `6 + 4·sqrt(attempts)`; its fill is the domain hue and its opacity is `0.35 + 0.65·mastery`. Prereq edges are solid with an arrow; related edges are dashed.
  - Pan and zoom: wheel zoom and drag pan through `viewBox` math (no d3-zoom).
  - Search: a box highlights matches with an O(V) filter and dims the rest.
  - Clicking a node opens `NodePanel`, which shows mastery, attempts and last seen, with actions **Teach** (POST `/api/lessons {prompt: name}`) and **Practice** (generate for this topic).
- Domain hues: a fixed 9-entry map in `theme.css` (`--d-math` … `--d-other`), tuned to stay legible on every season's background. The season accent is used only for selection and focus.
- Left overview card (as in `zYRyk.jpg`): concepts, connections, domains, average mastery.
- Empty state: an `AskBar` prompting "Learn your first topic".
- `/stats`:
  - Tiles: accuracy, retention, calibration error (lower is better), streak, due now, topics mastered.
  - A days selector: 7, 30 or 90.
  - `LineChart`: daily attempts (bars) plus accuracy (line), inline SVG with a hover tooltip.
  - `BarChart`: per-domain accuracy and retention.
  - A per-topic table, sortable on the client by any metric.
  - An "Trends noted by your tutor" card from `/api/insights`, each trend with an up, down or flat arrow.
  - Null metrics show "—".
- Charts are hand-rolled SVG with no chart library. Axes have labels, all text uses `--text`/`--muted`, and every chart has an `aria-label` summary.

INV:
- The graph renders ≤500 nodes and the matching edges at ≥30 fps while panning (static positions; only `viewBox` changes).
- Stats UI code never branches on a topic's name or domain value (it mirrors the P10 invariant).

TESTS: none (manual).

VERIFY: after the P12 flows, `/graph` shows the lesson topics clustered by domain, with prereq arrows from earlier lessons. Clicking a node and choosing Practice generates questions. `/stats` numbers match `curl /api/stats`. Check visually against `Sldul.jpg` and `zYRyk.jpg` under the spring and winter themes.

NO: 3D graphs, editing the graph by hand, exporting stats.
