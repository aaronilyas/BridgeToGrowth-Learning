export const JSON_TIMEOUT_MS = 60_000;
export const STREAM_TIMEOUT_MS = 120_000;

// INV: Bun.serve's default idleTimeout is 10s. Step generation and chat write no bytes until the model answers, so the socket is reset and the client reports "A provider is unavailable."
// Two JSON attempts, or one stream, plus retrieval and the database write that follow.
const IDLE_SLACK_MS = 30_000;
export const SERVER_IDLE_TIMEOUT_S = Math.ceil((Math.max(JSON_TIMEOUT_MS * 2, STREAM_TIMEOUT_MS) + IDLE_SLACK_MS) / 1000);
