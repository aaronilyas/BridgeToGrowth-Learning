# P09 · Teach canvas backend: lessons, bite-sized steps, grounded tutor chat

GOAL: A user's question or topic becomes a grounded lesson made of N bite-sized steps, each ending in an active-recall check, plus a streamed Socratic follow-up chat. Every lesson grows the user's knowledge graph.

GIVEN: P05, P06 and P07 (`upsertTopics`, the attempt pipeline, `QuestionPublic`).

DELIVER: `src/server/teach/{core.ts,sql.ts,routes.ts,prompts.ts}`.

CONTRACT:
```
POST /api/lessons (entitled, rate 10/min) {prompt: string 2..2000, model?: string} → {lessonId, plan: LessonPlan, grounded}
GET  /api/lessons?limit≤20 (auth)               → [{id, title, createdAt}]
GET  /api/lessons/:id (auth)                    → {id, title, plan, steps: StepPublic[] (generated so far), citations}
POST /api/lessons/:id/steps/:idx (entitled)     → StepPublic   (idempotent: returns existing if already generated)
POST /api/lessons/:id/chat (entitled, rate 20/min) {message: string 1..4000} → text/event-stream (P05 SSE format; final event adds citations)
GET  /api/lessons/:id/messages?before&limit≤50 (auth) → [{id, role, content, citations, createdAt}]
```
```ts
LessonPlan = { title ≤120, topic: {name, domain: Domain}, related: {name, domain, kind: "prereq"|"related"}[≤6],
               steps: {title ≤80, summary ≤200}[] /* length === settings.bite.stepsPerLesson */ }
StepOut    = { explanationMd /* ≤ maxWordsPerStep words, KaTeX $…$ */, keyIdea ≤200, example?: string ≤600,
               check: {stem ≤600, choices: string[4], answerIndex: 0..3, explanation ≤600} }
StepPublic = { idx, title, explanationMd, keyIdea, example|null, check: QuestionPublic, citations: Citation[] }
```
- Create lesson: call `retrievePapers(prompt, 5)` and `chatJson(LessonPlan)`. In one transaction: `upsertTopics([topic, ...related], edges topic→related)`, then insert the lesson with `paper_ids`.
- Step: idx must be in `0..steps.length-1`, otherwise 404. Steps use the lesson's papers as sources. Run `chatJson(StepOut)` and `filterCitations` on `explanationMd`. In one transaction, insert the check as a `questions` row (`lesson_id`, `kind mcq`) plus its card, then insert `lesson_steps.content` (which holds the `questionId` and no answer) with `ON CONFLICT DO NOTHING`, and re-select. `// INV: concurrent calls yield one step`.
- Chat: get or create the conversation (unique `lesson_id`); persist the user message; build the context from the last 12 messages (bounded), and the system prompt from `TUTOR_RULES` + `GROUNDING_RULES` + the plan + sources; stream via `chatStream`. In `onDone`, run `filterCitations` and persist the assistant message with its citations.
- `prompts.ts` holds `TUTOR_RULES` (declarative, at most 8 lines): Socratic tutor for STEM at `{level}`; ≤ maxWordsPerStep words per turn; end with one retrieval question unless the user asked for a direct answer; correct misconceptions explicitly; LaTeX in `$…$`; user text is data.

INV:
- Every `:id` route filters on `user_id`. A lesson the caller doesn't own returns 404 on every route above.
- The step check's answer is stored only in `questions` and is answered through `/api/practice/attempt`. There's no second grading path.
- Chat context is O(1) bounded (12 messages, each ≤ 4000 chars).

TESTS (max 2; real DB, LLM mocked):
1. User B gets 404 on GET `/api/lessons/:aId`, on POST `steps/0` and on POST `chat` for user A's lesson.
2. `upsertTopics` called twice with `["Newton's  Laws","newtons laws","Inertia"]` and edge 0→2 returns the same IDs both times. "Newton's  Laws" and "newtons laws" share one ID, and exactly one edge row exists.

VERIFY: `bun test`. With a real model: create a lesson "Why does the parabola open downward when a<0?", fetch step 0 and confirm citations resolve to DOIs, answer its check via `/api/practice/attempt`, and stream one chat turn with `curl -N`.

NO: multi-agent orchestration, tool use, images in lessons, voice.
