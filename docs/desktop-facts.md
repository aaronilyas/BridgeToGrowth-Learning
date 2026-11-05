# Desktop pivot: verified facts (Phase 0, 2026-11-02)

Verified on the build machine (Linux x64, Bun 1.4.4, codex-cli 0.166.0, grok 1.0.70) and in vendor docs. Each fact lists its source.

## 1. Codex (official CLI): DECISION KEPT

| Fact | Result | Source |
|---|---|---|
| Driving it from a program | `codex exec --json [PROMPT\|-]` prints JSONL on stdout. `codex app-server` (JSON-RPC over stdio) is marked `[experimental]` in `--help`. **Chosen: `codex exec --json`**, because it is the stable surface. | `codex exec --help`; https://learn.chatgpt.com/docs/non-interactive-mode.md |
| Event format | `thread.started`, `turn.started`, `item.started`/`item.updated`/`item.completed` (each item has `type`: `agent_message`, `reasoning`, `command_execution`, `file_change`, `mcp_tool_call`, `web_search`, `todo_list`, `error`), `turn.completed` with `usage{input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens}`, `turn.failed`, `error`. A real capture is in `src/server/llm/providers/fixtures/codex-structured.jsonl`. | captured run; non-interactive-mode doc |
| Streaming | `exec --json` streams **per item, not per token**: one `agent_message` arrives whole in `item.completed`. Token deltas (`item/agentMessage/delta`) exist only in the experimental app-server. The adapter emits each completed `agent_message` as one `text` event. Codex chat therefore appears in chunks, not a smooth stream. | captured run; `codex app-server generate-json-schema` |
| Structured output | `--output-schema <FILE>` (JSON Schema). The final `agent_message` text is the JSON. | `codex exec --help`; captured run |
| Image input | `-i, --image <FILE>...` attaches images to the initial prompt. The adapter writes images into the per-call temp dir. | `codex exec --help` |
| Model listing | `codex debug models` prints the raw catalog JSON: `models[].{slug,display_name,supported_reasoning_levels[].effort,input_modalities,context_window,visibility}`. Show `visibility == "list"` only. | `codex debug models` (local) |
| Reasoning effort | `-c model_reasoning_effort="low\|medium\|high\|xhigh\|max"`. Mapping: low→low, high→high, max→max (only if the model lists it, else xhigh/high). | `codex debug models` levels |
| No tools / no execution | `-s read-only -c approval_policy="never" -c web_search="disabled" --ephemeral --skip-git-repo-check --ignore-user-config --ignore-rules -C <empty tmp dir>`, plus `--disable` for `shell_tool unified_exec apps plugins multi_agent image_generation browser_use browser_use_external computer_use hooks sleep_tool view_image tool_suggest skill_search goals in_app_browser remote_plugin`. Verified: the run succeeds, the input-token count drops from 13.5k to 8.7k (tool schemas gone), and the temp dir stays empty. Do **not** disable `code_mode_host`: that only adds a non-fatal `error` item. Stdin must be closed or used as the prompt (`-`), or exec waits on it. | `codex features list`; captured runs |
| Login status | `codex login status`: exit 0 prints `Logged in using ChatGPT` (or API key). A non-zero exit means logged out. `codex login` (browser) / `codex login --device-auth` start login. | `codex login --help`; local run |
| Starting a login signs out | Starting `codex login --device-auth` deletes the saved session immediately, before the new sign-in completes (verified 2026-11-04: status went from logged in to `Not logged in` after a 15 s run that was cancelled). The app therefore refuses to start a login while Codex reports connected (409), and cancelling leaves Codex signed out. | local run, codex-cli 0.166.0 |
| Device-code output | stdout (ANSI-coloured) prints `https://auth.openai.com/codex/device`, then `Enter this one-time code (expires in 15 minutes)` and a code like `ABCD-EFGHI`. Browser login prints an `https://auth.openai.com/oauth/authorize?...` link as a fallback. `codexLogin.ts` parses only `https://auth.openai.com/` links and that code shape. | local run |
| Sign-out | `codex logout` removes the CLI's stored credentials. The app calls it rather than touching `~/.codex`. | `codex logout --help` |

**Terms note.** OpenAI documents Sign in with ChatGPT, with "ChatGPT plan usage", for "open-source and locally hosted apps". There the app obtains its own OAuth token and passes it to `codex app-server` (https://developers.openai.com/siwc/token-sharing-open-source, .../codex-app-server). The docs neither permit nor forbid spawning the user's own signed-in official CLI. `codex exec` "reuses saved CLI authentication by default" (non-interactive-mode doc). We follow the pivot Decision: the app only spawns the user's installed CLI. It never reads `~/.codex`, never refreshes tokens, and never calls ChatGPT endpoints. **Residual risk:** OpenAI may later require apps to use their own Sign in with ChatGPT registration instead.

## 2. SpaceXAI (xAI / Grok): SUBSCRIPTION VIA THE GROK CLI, API KEY AS FALLBACK

Re-verified 2026-11-05 against grok 1.0.70 on Linux x64.

| Fact | Result | Source |
|---|---|---|
| Subscription mechanism | The official Grok Build CLI (`grok`) signs in with a grok.com account (`grok login`) and runs headless with `grok --prompt-file <F> --output-format streaming-json`. The app spawns only the user's installed CLI, never reads `~/.grok`, and never calls grok.com endpoints itself. | `grok --help`; local runs |
| **Decision** | 2026-11-05: at the owner's request, SpaceXAI can use the user's Grok subscription through the CLI. **A signed-in subscription wins over a stored API key.** The key path (below) is the fallback. Terms caveat: xAI's docs do not say subscription use in third-party apps is permitted, and recommend `XAI_API_KEY` for headless automation. | https://docs.x.ai/build/cli/headless-scripting |
| Login status | No `login status` command. `grok models` **exits 0 even when signed out**. Signed in, it prints `You are logged in with grok.com.`; signed out, `You are not authenticated.` It then lists `  * <id> (default)` / `  - <id>` lines. That list is the subscription model catalog. ~0.4 s per call, so status is cached for 30 s. | local runs (real and throwaway HOME) |
| Login | `grok login --device-auth` prints on **stderr** `https://accounts.x.ai/oauth2/device?user_code=XXXX-XXXX` and `Confirm this code in your browser:` + the code. `grok login --oauth` prints `https://auth.x.ai/oauth2/authorize?...` (loopback redirect). `grok logout` clears credentials. Whether starting a login discards an existing session is unverified, so the app refuses to start one while signed in (409). | throwaway-HOME runs |
| Events | NDJSON: `available_commands`, `thought` (reasoning deltas), `text` `{data}` (token deltas), `usage` `{usage:{input_tokens,cache_read_input_tokens,output_tokens,...}}`, `end` `{stopReason,...,structuredOutput?}`, `error` `{message}`, `tool_call`, `tool_call_update`. The adapter allowlists the first six; **anything else (any tool call) aborts**. | captured runs |
| No tools | `--disallowed-tools <every built-in>` empties the local tool list; plus `--disable-web-search --no-subagents --no-plan --max-turns 1 --permission-mode dontAsk --sandbox strict --system-prompt-override <fixed> --cwd <empty tmp dir>`. `--tools ""` does **not** remove tools. xAI **server-side** X search (`x_keyword_search` etc.) cannot be disabled by flag; it surfaces as `tool_call`, which aborts the call. | captured runs |
| Structured output | `--json-schema '<schema JSON>'`: text deltas carry the JSON; `end.structuredOutput` repeats it. | captured run |
| Images | `--prompt-json` with an ACP image block was rejected ("rejected for size"), and the model then tried a shell command (blocked by `dontAsk`). Subscription models are therefore listed `vision: false` and images are not sent. | captured run |
| Errors | Signed out: `{"type":"error","message":"Not signed in..."}`, exit 1. Unknown model: `error` with `unknown model id`. Mapped with the Codex failure mapper. | captured runs |

API-key path (fallback):

| Fact | Result | Source |
|---|---|---|
| Endpoint | `https://api.x.ai/v1`, OpenAI-compatible `POST /chat/completions` (the Responses API `/v1/responses` is "primary"). The docs brand the vendor "SpaceXSI". The host is still `api.x.ai`. | https://docs.x.ai/docs/api-reference, https://docs.x.ai/docs/guides/streaming-response |
| JSON mode | `response_format: {type:"json_schema", json_schema:{name,schema,strict:true}}`. `additionalProperties` defaults to false. | https://docs.x.ai/docs/guides/structured-outputs |
| Vision | Image parts as `data:` URLs (jpg/png, ≤20 MiB). | https://docs.x.ai/docs/guides/image-understanding |
| Streaming | SSE `data:` lines end with `data: [DONE]`. `usage` is present on chunks. | streaming-response guide |
| Model listing | No endpoint page could be fetched. Use OpenAI-compatible `GET /v1/models` (also the cheap, non-billable key check). If it fails, fall back to a curated list built from https://docs.x.ai/docs/models. | inferred; marked unverified |
| Reasoning | `reasoning_effort` (values depend on the model). Map low→"low", high/max→"high". | api-reference |

## 3. Bun: NO FALLBACK NEEDED

- `Bun.SQL` with `sqlite://` works on Bun 1.4.4 (SQLite 3.53.4): tagged templates, `sql([...])` IN-list helper, `sql.begin`. Verified locally.
- `Bun.secrets` exists with `get`, `set` and `delete` (OS keychain: libsecret / Keychain / Credential Manager). Verified locally.
- `Bun.Archive` writes **tar**, not zip, so export uses `fflate` (a new dependency).

## 4. Desktop shell: ELECTROBUN

- Electrobun 2.0.5 (MIT) lists macOS arm64/x64, Windows x64 and Linux x64/arm64 as stable. It uses a Bun main process with the system webview (WebKitGTK 4.1 on Linux, which is installed here: webkit2gtk-4.1 2.54.1, gtk3 3.24.52) or a bundled CEF. Sources: https://blackboard.sh/electrobun/docs/guides/compatability, https://framework.blackboard.sh/electrobun/guides/changelog/v2-x/.
- Electrobun does not produce AppImage or .deb itself. `scripts/package-linux.ts` wraps its Linux build output with appimagetool / dpkg-deb, which are fetched or installed in CI.
- No Tauri fallback is needed.

## 5. Other pinned choices

- Pyodide 314.0.7 (MPL-2.0), bundled. No CDN at runtime.
- PDF text: `unpdf` 2.1.0 (MIT, a serverless pdf.js build).
- Zip export: `fflate` 0.8.3 (MIT).

## Residual risks

- **Codex tool execution.** A prompt-injected model could still try a tool call. Tool features are disabled, the sandbox is read-only, the network is off, the cwd is an empty temp dir, approvals are never granted, and any tool or command item aborts the call. A CLI update could re-enable a tool under a new feature name. The adapter's abort-on-unknown-item rule is the backstop: anything other than `agent_message`, `reasoning` or `error` aborts.
- **Codex terms.** See the terms note above.
- **Grok subscription terms.** xAI does not document subscription use in third-party apps (section 2). A CLI update could add a tool under a new name; the abort-on-unknown-event rule is the backstop.
- **Codex streaming is coarse.** `exec --json` delivers whole messages, so Codex chat appears all at once rather than token by token.
- **Codex quota.** A ChatGPT plan's usage limit surfaces as `quota_exhausted`. This was verified on 2026-11-02 against a real exhausted account.
- **Pyodide is advisory.** Hidden tests reach the renderer, so a learner can forge a pass. Generation no longer executes the reference solution, so a wrong reference can be stored.
- **Pyodide memory.** Python runs synchronously inside the worker, so the in-worker heap poll cannot fire mid-run. A runaway allocation is bounded by WebAssembly's own memory limit and the 10 s hard timeout (`worker.terminate()`), not by the 512 MB poll.
- **Scanned PDFs.** Ghostscript compression is gone. A lesson PDF with no text layer becomes an empty attachment. Style uploads still send the original PDF, up to 10 MB.
- **Build-time downloads.** `scripts/fetch-pyodide.ts` downloads Pyodide wheels from the jsDelivr mirror of the 314.0.7 release, and `package:linux` downloads appimagetool 1.9.1. Both are SHA-256 pinned. Nothing is fetched at runtime.
- **Unsigned builds.** There is no code signing, notarization or auto-update yet; `.github/workflows/desktop.yml` has stubs for them, described in docs/packaging.md.
- **Local attack surface.** Another local process running as the same OS user can read the SQLite file, and can talk to the backend if it learns the launch token. The token and the Host and Origin checks defend against web pages and DNS rebinding, not against local malware.

## History

This app was previously a hosted service. It ran on Postgres with accounts, Stripe billing, Turnstile, Resend mail, AdSense, a Caddy reverse proxy, and a bwrap/cgroup sandbox for code and PDF tools (pg_dump backups, citext columns). All of that was removed in the desktop pivot (branch `desktop-pivot`).
