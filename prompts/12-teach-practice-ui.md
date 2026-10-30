# P12 · Teach canvas and Practice pages

GOAL: The Teach canvas (ask, then a lesson with steps, checks and follow-up chat) and the Practice tab (spaced-repetition queue, generation, style uploads) work end to end against P07–P09.

GIVEN: P07, P08, P09 and P11 (shell, `api`, `streamSse`, `Md`, theme).

DELIVER: `src/web/pages/{Teach,Lesson,Practice}.tsx` and `src/web/components/{AskBar,QuestionCard,ConfidenceSlider,StepView,ChatPanel,Sources,UploadDrop}.tsx`.

CONTRACT (layouts follow the mockups; reuse components across pages):
- `/teach` (bottom bar of `Sldul.jpg`): `AskBar` holds a "What do you want to learn?" input, a model `<select>` (`/api/models`, defaulting to `settings.model`) and Teach / Practice buttons. Teach posts to `/api/lessons` and navigates to `/teach/:id`. Practice calls `generate({topic})` and navigates to `/practice`. Below the bar, list recent lessons (`/api/lessons`).
- `/teach/:id` (3 columns, as in `5CGzr.jpg` and `hraFq.jpg`):
  - left: a step list with status (done, current, not started).
  - centre: `StepView` shows "Lesson i of N", title, `explanationMd` via `Md`, a Key Idea callout on `--accent-soft`, an optional example, and `QuestionCard` for the check, followed by `Sources`.
  - right: lesson-plan progress plus `ChatPanel`, a streamed follow-up chat (`streamSse`, abortable, auto-scroll, `Md` per message, citations).
  - Steps are generated lazily (POST `steps/:idx` when the step opens) behind a skeleton loader.
- `QuestionCard` (shared by Teach and Practice): stem via `Md`; MCQ options A–D (radio, keys 1–4) or a free-response textarea; `ConfidenceSlider` 0–100 when `settings.recall.confidencePrompt`; an optional "Your thinking" box (sent as `response`); Submit (Enter). It records `latencyMs` from mount to submit. After submission it shows correct or incorrect, the score, feedback, explanation, the correct choice highlighted and "next review in N days".
- `Sources`: numbered list `[n] Title (Year)`, linked to `https://doi.org/<doi>` when a DOI is present.
- `/practice`:
  - Due queue (`/api/practice/queue`), one card at a time, with a daily-goal progress bar.
  - Empty state: "All caught up", plus the generate panel.
  - Generate panel: topic, count, kind (mcq/free/mix), a style `<select>` (`/api/styles`) and `UploadDrop`.
  - `UploadDrop` accepts `.pdf` and `.png` only and checks size ≤10 MiB on the client before POSTing. The new style appears selected.
- Error handling: `quota_exceeded` shows a banner linking `/usage`; `payment_required` navigates to `/billing`; `llm_bad_output` or `upstream` shows a retry button.

INV:
- The client never receives or infers an answer before submit; it shows exactly what the attempt response returns.
- Every list renders O(n) with keys. Chat appends to state without re-rendering earlier messages (memoised message rows).
- No `dangerouslySetInnerHTML` anywhere.

TESTS: none (verified manually).

VERIFY (manual, with a real model):
1. Ask "Photosynthesis light reactions" and step through all steps, answering each check with different confidence levels.
2. Ask one follow-up in the chat and confirm the stream renders and the citations link to DOIs.
3. Upload a PNG problem, generate 4 questions in that style, and answer them in `/practice`.
4. Confirm the answered cards leave the queue.
5. Compare the screen with `5CGzr.jpg` for each season.

NO: dictation, drag-and-drop reordering, saving drafts.
