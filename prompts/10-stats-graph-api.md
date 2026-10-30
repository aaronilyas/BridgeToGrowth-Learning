# P10 · Stats, knowledge graph and insights API

GOAL: Read APIs for the knowledge graph and for performance stats whose metrics are topic-independent, plus a daily cached LLM summary of trends.

GIVEN: P07 (rollups in `topics`, `daily_activity` and `cards`).

DELIVER: `src/server/stats/{core.ts,sql.ts,routes.ts}`.

CONTRACT:
```
GET /api/graph (auth)              → {nodes:[{id,name,domain,mastery,attempts,lastSeenAt}] (LIMIT 500 by last_seen_at desc), edges:[{src,dst,kind}] (only edges whose ends are both in nodes)}
GET /api/stats?days=7..365 (auth)  → Stats
GET /api/insights (entitled)       → {day, trends:[{text ≤200, metric: MetricKey, direction:"up"|"down"|"flat"}] ≤5}
```
```ts
type Metrics = { attempts: number; accuracy: number|null; retention: number|null; calibrationError: number|null; masteredShare: number|null };
type MetricKey = keyof Metrics | "streakDays" | "dueNow";
// core.ts (pure) — the ONLY function that computes metrics
export function computeMetrics(r: {attempts: number; correct: number; reviews: number; reviewCorrect: number; confErrSum: number; mastered?: number; topics?: number}): Metrics; // O(1)
export function streakOf(days: {day: string; attempts: number}[], today: string): number; // O(days) consecutive days with attempts>0, ending today or yesterday
Stats = { totals: Metrics & {streakDays, dueNow, topicsStarted, goalToday:{done, target}},
          daily: ({day} & Metrics)[], byDomain: ({domain} & Metrics)[], byTopic: ({id,name,domain} & Metrics)[] /* LIMIT 50 */ }
```
- accuracy = correct/attempts · retention = reviewCorrect/reviews · calibrationError = confErrSum/attempts · masteredShare = mastered/topics. A zero denominator gives null.
- SQL: `daily_activity` filtered by user and day range (PK range scan); `topics` aggregated by domain in one GROUP BY; `dueNow` = `count(*) FROM cards WHERE user_id=$1 AND due_at<=now()` (index-only).
- Insights: a row in `insights` for `(uid, UTC today)` is returned as is. Otherwise call `chatJson(SYSTEM_MODELS.insight)` with the input `JSON.stringify(Stats)` only (numbers and topic names, no user free text), store it and return it. `// INV: ≤1 LLM call per user per day`.

INV:
- Topic-independence: no branch, constant or prompt anywhere in stats depends on a topic's name or domain value. Domain and topic are only GROUP BY keys and labels.
- The stats endpoint runs at most 4 queries, each indexed and bounded, and does no per-topic loop over queries.

TESTS (max 1):
1. Two fixtures with identical counters but different topic names and domains (e.g. "Quantum Tunneling"/physics vs "Krebs Cycle"/biology) give deep-equal `computeMetrics` output. `streakOf` returns 3 for activity on today−2..today and 0 when the last activity was 2 days ago.

VERIFY: `bun test`. After a few P07 attempts, `curl /api/stats?days=30` and `/api/graph` return coherent numbers. A second `/api/insights` call the same day adds no `llm_calls` row.

NO: cohort or global analytics, exports, charts (that's P13).
