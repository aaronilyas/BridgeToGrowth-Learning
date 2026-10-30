export type AuthUser = {
  id: string;
  email: string;
  settings: Record<string, unknown>;
  trial_ends_at: Date;
  sub_status: string;
  sub_period_end: Date | null;
  sub_cancel_at_period_end: boolean;
};

export const SESSION_SECONDS = 30 * 24 * 60 * 60;
export const MAX_SESSIONS = 10;
const COOKIE = "__Host-sid";
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

// O(1)
export function createToken(): string {
  return new Uint8Array(crypto.getRandomValues(new Uint8Array(32))).toBase64({ alphabet: "base64url", omitPadding: true });
}

// O(1)
// INV: only sha256(token) is ever stored
export function hashToken(token: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new Bun.CryptoHasher("sha256").update(token).digest());
}

// O(n) in header length
export function readSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === COOKIE) {
      const v = part.slice(eq + 1).trim();
      return TOKEN_RE.test(v) ? v : null;
    }
  }
  return null;
}

// O(1)
// SEC: __Host- prefix requires Secure, Path=/ and no Domain; browsers treat http://localhost as secure
export function formatSessionCookie(token: string, maxAge: number = SESSION_SECONDS): string {
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

// O(1)
export function formatClearCookie(): string {
  return formatSessionCookie("", 0);
}
