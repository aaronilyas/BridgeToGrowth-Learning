import { env } from "../env.ts";

const RESET_SUBJECT = "Reset your BridgeToGrowth password";

// O(1)
export function passwordResetEnabled(): boolean {
  return Boolean(env.RESEND_API_KEY && env.MAIL_FROM);
}

// O(1) network call
// SEC: the Resend key stays in the Authorization header and is never logged; a failed send reports only the status
export async function sendPasswordReset(to: string, url: string): Promise<boolean> {
  const key = env.RESEND_API_KEY;
  const from = env.MAIL_FROM;
  if (key === undefined || from === undefined) return false;
  const text = `A password reset was requested for your BridgeToGrowth account.\n\nOpen this link within one hour to choose a new password:\n${url}\n\nThe link works once. If you didn't ask, you can ignore this email.`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: RESET_SUBJECT, text }),
    });
    if (!res.ok) console.error(`password reset mail failed: ${res.status}`);
    return res.ok;
  } catch {
    console.error("password reset mail failed");
    return false;
  }
}
