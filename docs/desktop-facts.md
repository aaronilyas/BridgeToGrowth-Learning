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

**Terms note.** OpenAI documents Sign in with ChatGPT, with "ChatGPT plan usage", for "open-source and locally hosted apps". There the app obtains its own OAuth token and passes it to `codex app-server` (https://developers.openai.com/siwc/token-sharing-open-source, .../codex-app-server). The docs neither permit nor forbid spawning the user's own signed-in official CLI. `codex exec` "reuses saved CLI authentication by default" (non-interactive-mode doc). We follow the pivot Decision: the app only spawns the user's installed CLI. It never reads `~/.codex`, never refreshes tokens, and never calls ChatGPT endpoints. **Residual risk:** OpenAI may later require apps to use their own Sign in with ChatGPT registration instead.

## 2. SpaceXAI (xAI / Grok): FALLBACK TAKEN, API KEY ONLY

| Fact | Result | Source |
|---|---|---|
| Subscription mechanism | The official Grok Build CLI (`grok`, npm `@xai-official`) supports `grok login` (browser OIDC / device code), headless `grok -p --output-format streaming-json`, and ACP (`grok agent stdio`) "in other apps". The docs never tie `grok login` to a SuperGrok subscription and never say subscription use in third-party apps is permitted. The consumer terms (https://x.ai/legal/terms-of-service) returned 403 and could not be read. They recommend `XAI_API_KEY` for "scripts, CI/CD, headless automation". | https://docs.x.ai/build/cli/headless-scripting, https://docs.x.ai/build/enterprise, https://docs.x.ai/build/overview |
| **Decision** | No permitted subscription mechanism was confirmed, so we use the **API-key fallback**. The `spacexai` adapter is `auth: "api_key"`. If xAI documents the permission later, the ACP path can be added as another adapter. | |
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

- Codex: a prompt-injected model could still try a tool call. Tool features are disabled, the sandbox is read-only, the network is off, the cwd is an empty temp dir, approvals are never granted, and any tool or command item aborts the call. A CLI update could re-enable a tool under a new feature name. The adapter's abort-on-unknown-tool-item rule is the backstop.
- Codex terms (see above).
- Pyodide runs inside the renderer process. Grading is advisory, because the user owns the machine.
- Unsigned builds: no code signing, notarization or auto-update yet.
