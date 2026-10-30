# P08 · Question generation: standard and style-mimic (PDF/PNG uploads)

GOAL: Users can generate standard practice questions for any STEM topic, or questions that mimic the style of a PDF or PNG they upload. Every generated question goes into the P07 queue.

GIVEN: P05, P06 and P07 (`upsertTopics`, `QuestionPublic`, the cards table).

DELIVER: `src/server/gen/{core.ts,sql.ts,routes.ts}` and `src/server/styles/{core.ts,sql.ts,routes.ts}`.

CONTRACT:
```
POST /api/questions/generate (entitled, rate 10/min)
  {topic: string 2..120, count: 1..20, kind: "mcq"|"free"|"mix" = "mix", styleId?: uuid, model?: string}
  → {topicId, grounded: boolean, questions: QuestionPublic[]}
POST /api/styles (entitled, rate 5/min, maxBody 10 MiB, multipart field "file") → {styleId, profile: StyleProfile}
GET  /api/styles (auth)          → [{id, subject, mime, createdAt}] LIMIT 50
DELETE /api/styles/:id (auth)    → 204 | 404
```
```ts
// LLM output schema for generation (validated, then normalized):
GenOut = { topic: {name ≤120, domain: Domain}, questions: { kind, stem ≤1500, choices?: string[4], answerIndex?: 0..3,
           rubric?: string ≤800, modelAnswer?: string ≤1500, explanation ≤1200 }[] }
//   mcq requires choices.length===4 && answerIndex; free requires rubric+modelAnswer; otherwise drop that question. If 0 remain, 502 llm_bad_output.
StyleProfile = { subject ≤80, domain: Domain, level: "intro"|"undergrad"|"grad", questionTypes: string[≤5], multiPart: boolean,
                 notation: "latex"|"plain", usesUnits: boolean, difficulty: 1..5, length: "short"|"medium"|"long",
                 exemplars: string[≤3] /* paraphrased, ≤300 chars each, never verbatim */ }
// styles/core.ts (pure)
export function sniffMime(head: Uint8Array): "application/pdf"|"image/png"|null; // O(1) %PDF- | \x89PNG\r\n\x1a\n
```
Generate: `count ≤ settings.bite.questionsPerSession`. The free-response count is `round(count × recall.freeResponseRatio)` for `mix`. Call `retrievePapers(topic, 3)`, then `chatJson` with system = role + level + `GROUNDING_RULES` + sources + (style profile JSON inside `<user_data>` if `styleId`). Run `filterCitations` on each explanation. Then, in one transaction: `upsertTopics`, insert the questions (`answer = {index}` or `{rubric, model}`), and insert the cards with `due_at = now()`.
Upload: check content-length; `sniffMime(first 8 bytes)`; reject if it's null or differs from the declared type (415 `unsupported_media`); compute sha256; if `(user_id, sha256)` exists, return the existing style. Enforce at most 50 styles per user. Call `chatJson(SYSTEM_MODELS.extract, StyleProfile)` with the file as a data-URL content part (PDF as `{type:"file"}`, PNG as `{type:"image_url"}`). Store the profile only.

INV:
- Uploaded bytes are never written to disk or the DB, never served back and never parsed on the server beyond the magic bytes. `// SEC: no parser attack surface`. The style-profile cost is charged to the user's quota.
- `styleId` must belong to the caller (404 otherwise).
- The response never contains answers (it uses `QuestionPublic`).
- Generation runs O(count) inserts in one batched statement per table.

TESTS (max 1):
1. A `sniffMime` table: real PDF header → pdf; PNG header → png; PNG declared as PDF is rejected by the route-level check (a pure helper `acceptUpload(head, declared)`); `<svg`, `PK\x03\x04` (zip), `<!doctype html` and empty input → null.

VERIFY: `bun test`. Manually: upload a PNG of a textbook problem and inspect the profile, generate 4 questions with that `styleId` and confirm the stems match the style, then confirm `/api/practice/queue` returns them.

NO: OCR, storing originals, sharing styles between users, Word or JPEG formats.
