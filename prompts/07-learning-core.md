# P07 · Learning core: settings, SM-2, attempts, rollups, topics

GOAL: Learning behaviour (spaced repetition, active recall, bite size, daily practice) is driven by user settings. Every answer, whatever its source, goes through one attempt pipeline that grades it, schedules the card and updates the rollups in a single transaction.

GIVEN: P05 (`chatJson`, `SYSTEM_MODELS.grade`).

DELIVER: `src/shared/settings.ts`, `src/server/learn/{core.ts,sql.ts,routes.ts}`, `src/server/topics/{core.ts,sql.ts}`, and schemas in `src/shared/api.ts`.

CONTRACT:
```ts
// src/shared/settings.ts — zod schema with .default() on every field; parse({}) yields full defaults
Settings = {
  level: "undergrad"|"grad" = "undergrad",
  model: string|null = null,                         // null → first MODELS entry for the plan
  season: "auto"|"spring"|"summer"|"fall"|"winter" = "auto",
  srs:      { enabled: true, newPerDay: 10 /*0..50*/, maxReviewsPerDay: 50 /*0..500*/ },
  recall:   { freeResponseRatio: 0.3 /*0..1*/, confidencePrompt: true },
  bite:     { stepsPerLesson: 4 /*2..8*/, maxWordsPerStep: 180 /*60..400*/, questionsPerSession: 8 /*3..20*/ },
  practice: { dailyGoal: 10 /*1..100*/ },
}
// learn/core.ts (pure, O(1))
export function qualityOf(score: number, confidence: number): 0|1|2|3|4|5;
//   score≥.85&&conf≥70→5 · score≥.85→4 · score≥.6→3 · conf≥70→0 (confident error) · conf≥40→1 · else 2
export function scheduleSm2(c: Card, q: number, now: Date): Card;
//   q<3: reps=0, interval=1, lapses+1 · else reps+1, interval = reps==1?1 : reps==2?6 : round(interval*ef)
//   ef = max(1.3, ef + .1 - (5-q)*(.08 + (5-q)*.02)); due_at = now + interval days
export function nextMastery(m: number, score: number): number;   // EMA α=0.3
// topics/core.ts + sql.ts
export function slugOf(name: string): string;                   // O(n) NFKD, strip marks and apostrophes, lowercase, [a-z0-9]+ joined by "-", ≤64
export function upsertTopics(tx, uid, topics: {name; domain: Domain}[], edges: {src: number; dst: number; kind}[]): Promise<string[] /*ids, input order*/>;
//   one batched INSERT … ON CONFLICT (user_id,slug) DO UPDATE SET name=topics.name RETURNING; edges ON CONFLICT DO NOTHING; self-edges dropped
export type Domain = "math"|"physics"|"chemistry"|"biology"|"cs"|"engineering"|"statistics"|"earth"|"other";
```
```
GET /api/settings (auth)                    → Settings
PUT /api/settings (auth) {deep partial}     → Settings   (merge, then validate the full object, then store)
GET /api/practice/queue?limit≤50 (entitled) → QuestionPublic[]   due cards, ORDER BY due_at, LIMIT min(limit, maxReviewsPerDay − today's reviews)
POST /api/practice/attempt (entitled, rate 60/min)
  {questionId: uuid, choice?: 0..3, response?: string≤5000, confidence: 0..100, latencyMs: 0..3.6e6}
  → {score, correct: score≥.6, feedback|null, answer, explanation, citations, nextDueAt}
QuestionPublic = {id, topicId, kind, stem, choices|null, lessonId|null}   // NEVER answer, explanation or rubric
```
Attempt pipeline:
1. Load the question `WHERE id=$q AND user_id=$uid`. If it's missing, return 404.
2. Grade it. For MCQ, `score = choice === answer.index ? 1 : 0` (deterministic, no LLM). For free response, call `chatJson(SYSTEM_MODELS.grade, schema {score: 0..1, feedback ≤600 chars})` with the rubric and model answer in `system` and the response in `<user_data>`.
3. In one transaction: insert the attempt (`is_review = card existed and reps > 0`); upsert the card via `scheduleSm2(qualityOf(…))`; update the topic rollup (`attempts+1`, `correct += score ≥ .6`, `conf_err_sum += |conf/100 − score|`, mastery EMA, `last_seen_at`); upsert `daily_activity`, including the review columns.

INV:
- `answer`, `explanation` and `rubric` leave the server only in the attempt response. Responses are built only from the explicit `QuestionPublic` schema, and the attempt response adds the answer fields after grading.
- When `srs.enabled = false`, the queue returns `[]` and attempts still record stats but don't change `due_at`.
- The queue is O(log N + limit) via `cards(user_id, due_at)`. The attempt runs O(1) statements.

TESTS (max 3; real DB, LLM grader mocked):
1. A table-driven `qualityOf` + `scheduleSm2` test of 8 rows covering the first, second and third successes, a lapse, the ef floor at 1.3 and a confident error.
2. Seed a question and card, then GET queue: no key `answer`, `explanation` or `rubric` appears at any depth (walk the JSON recursively). POST attempt: the response contains `answer`.
3. Three attempts (scores 1, 0, 1; confidence 80, 80, 50) leave the topic with `attempts=3`, `correct=2` and the EMA mastery expected to within 1e-6.

VERIFY: `bun test`.

NO: FSRS, notifications or reminders, leaderboards.
