// INV: Bun.serve rejects an idleTimeout above 255s, so every model budget must fit under it with slack
export const BUN_MAX_IDLE_S = 255;

// INV: one deadline for a whole chatJson call, the bad-JSON retry included. Subscription CLIs (Grok, Codex) reason at high effort and ignore
// the output-token cap: one Grok lesson plan took 105s, so a 90s budget failed every time with "The model took too long."
export const JSON_TIMEOUT_MS = 210_000;
export const STREAM_TIMEOUT_MS = 120_000;

// INV: Bun.serve's default idleTimeout is 10s. Step generation and chat write no bytes until the model answers, so the socket is reset and the client reports "A provider is unavailable."
// The longest model budget, plus retrieval and the database write that follow.
const IDLE_SLACK_MS = 30_000;
export const SERVER_IDLE_TIMEOUT_S = Math.min(BUN_MAX_IDLE_S, Math.ceil((Math.max(JSON_TIMEOUT_MS, STREAM_TIMEOUT_MS) + IDLE_SLACK_MS) / 1000));
