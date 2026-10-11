# Live video-generation investigation — 2026-10-11

Start: **12:52:27 UTC**. Hard deadline: **13:12:27 UTC**.
Remote main and the clean initial checkout were both `e57dc7f`.

## Evidence and changes

The original account's failed lesson stopped in generation, had no evaluation
or delivery attempt, and completed cleanup. Its original renderer stderr had
been discarded, so the exact exception from that historical attempt is unavailable.
Live isolated-worker requests reproduced Gemini HTTP 503 `UNAVAILABLE` with a
high-demand message. Both proxy connectivity and a real authenticated account
were verified. The LAN bridge targeted ordinary loopback FastAPI port 8000;
the substituted QA backend was not used.

Gemini now retries transient HTTP failures at most twice, with bounded backoff;
message sends are never retried by this change. The active local model setting
is `gemini-3.5-flash`, selected after a successful full-code generation probe.
Availability remains intermittent: voiceover attempts also encountered 503s,
and actual-video evaluation encountered 503 and 429 responses.

The isolated worker retains only a 64 KiB renderer-output tail in disposable
work tmpfs. Failed generation/render commands retain bounded private stderr
in coordinator tmpfs, surviving per-job cleanup. Video stdout is never logged
or stored. Public logs contain stage and exception class only.

A real silent baseline was rejected by Gemini's actual-video evaluation for
partial text artifacts and timing. The generation prompt now budgets requested
timing and uses fully formed text with FadeIn. Evaluation requirements were
preserved; no approval was forced.

Coordinator image running: `9e6ffeb57a47`.
Renderer image running: `5742ba9fda54`.
Existing idle renderers were retired only after process-state and durable job
protection checks. Restarts drained jobs gracefully. Authentication, the account,
database, messaging service, and restricted egress configuration were preserved.

## Verification

All **79 required acceptance tests passed with zero skips** (90.326 seconds).
The final focused integration, worker, and private-diagnostic tests also passed
(15 tests), and `git diff --check` passed.

Lesson `c0d1a61c-4408-4707-a060-7a55ee19649a`, submitted through the physical app
with voiceover off, produced a genuine **17.067-second** MP4. It passed existing
duration/size checks and all three Gemini actual-video quality checks. The real
Node/Photon attachment integration accepted it. It appeared in the matching
physical iPhone Messages conversation, and a read receipt was recorded at
13:09:06.841 UTC. Timed physical-screen captures show its equal-denominator
fraction animation progressing. Contact details and verification codes are
excluded from the cropped evidence. The user reported no audio; this delivered
clip was explicitly requested without voiceover.

Narrated lesson `3aff9cba-10a5-4879-a08b-a85f58e22846` rendered for **27.84 seconds**
and passed the worker's audio-stream requirement, but actual-video evaluation
failed on provider HTTP errors. It was not delivered. Audible narration and
successful narrated delivery remain unproven.

Final narrated attempt: `a91973d1-bbe9-4e0d-8848-8caff53f99b7`.
It failed during validation before rendering or delivery, with cleanup complete.
The final account audit found no active jobs, pending cleanup, or unresolved
delivery attempts. The full requested outcome remains unproven because narrated
delivery and audible physical playback were not verified. The next step is to
inspect Gemini's rate/quota and retry-delay response, then retry the small narrated
lesson through the physical app when provider requests can complete, retaining
all evaluation checks and verifying its audible physical playback.

Private sanitized metadata and diagnostic evidence are under ignored
`.local/iphone-testing/video-fix/`. Original topic and account information remain
private. No generated video was persisted outside its disposable processing
container by this investigation.

## Authorized six-minute continuation — verified narrated delivery

The user authorized another **six minutes**, starting **13:13:12 UTC**, with a
new deadline of **13:19:12 UTC**. The original 20-minute window did not establish
narrated delivery; the following result was achieved during the extension.

A real Gemini response identified `gemini-3.5-flash`'s exhausted daily free-tier
request quota: `GenerateRequestsPerDayPerProjectPerModel-FreeTier`, value **20**,
with a retry delay of **38785 seconds**. This is separate from the earlier
reproduced 503 overload failures. The adapter now stops on daily quota failures
or retry windows exceeding its bounded retry policy, and honors shorter provider
retry delays. Error bodies remain private and available to the caller.

`gemini-3.1-flash-lite` was available under the same existing account. Its live
scope response returned one JSON object in a singleton array. The adapter now
normalizes that unambiguous form, rejects other non-object/ambiguous forms, and
preserves the existing strict scope, generated-code, and evaluation field checks.
The local model configuration is now **`gemini-3.1-flash-lite`**.

Final running coordinator image: **`67574f74c9a6`**.
Final running renderer image: **`ad35a360e28e`**.
Both were rebuilt and activated after draining and confirming the previous
renderer idle. Authentication and the existing messaging service remain intact.

The physical app submitted narrated fractions lesson
**`77ab28e7-2d45-42e8-8764-1aef84cd1420`** with voiceover confirmed on. Real Gemini
scope assessment and code generation, isolated Manim/GTTS rendering and ffprobe,
actual-video Gemini evaluation, and the Node/Photon attachment integration all
completed successfully. Its genuine MP4 lasts **21.334 seconds** and passed the
existing duration, size, and audio-stream checks. All six video/narration quality
booleans were true; evaluation approval was never bypassed.

The new attachment appeared in the physical iPhone's matching Messages
conversation. Read receipt: **13:17:05.811 UTC**. Timed contact-free crops show
the video progressing to **1/5 + 2/5 = 3/5** without obvious corruption. At
**13:17:51 UTC**, the user confirmed **“Narration is audible and clear.”**
This verifies actual receipt, playback, and audible narration, beyond provider
acceptance or rendering alone.

The final required acceptance suite passed **82 tests with zero skips** in
**105.953 seconds**. All **18 focused tests** passed, and `git diff --check`
passed. The final account audit found **zero active jobs**, **zero pending
cleanup**, and no unresolved delivery attempts. The work remains local and
uncommitted. The narrated end-to-end goal is verified within the authorized
six-minute continuation; no remaining blocker was observed for this lesson.
