import { env } from "../env.ts";

const URL_VERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// O(1) network call, 5 s timeout
// SEC: any error or timeout is a failure; hostname is pinned in production
export async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  try {
    const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip });
    const res = await fetch(URL_VERIFY, { method: "POST", body: form, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const data: unknown = await res.json();
    if (typeof data !== "object" || data === null) return false;
    const d = data as { success?: unknown; hostname?: unknown };
    if (d.success !== true) return false;
    if (env.NODE_ENV === "production") return d.hostname === new URL(env.APP_ORIGIN).hostname;
    return true;
  } catch {
    return false;
  }
}
