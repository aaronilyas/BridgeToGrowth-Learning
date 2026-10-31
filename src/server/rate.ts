type Bucket = { tokens: number; t: number; cap: number; perMin: number };

const MAX_KEYS = 100_000;
const buckets = new Map<string, Bucket>();

function refill(b: Bucket, now: number): void {
  b.tokens = Math.min(b.cap, b.tokens + ((now - b.t) / 60_000) * b.perMin);
  b.t = now;
}

// O(1)
// INV: map never exceeds MAX_KEYS; over the cap, new keys are denied
export function takeToken(key: string, cap: number, perMin: number, now: number = Date.now()): boolean {
  let b = buckets.get(key);
  if (!b) {
    if (buckets.size >= MAX_KEYS) return false;
    b = { tokens: cap, t: now, cap, perMin };
    buckets.set(key, b);
  } else refill(b, now);
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

// O(1)
// INV: does not insert a key and does not spend a token
export function hasToken(key: string, cap: number, perMin: number, now: number = Date.now()): boolean {
  const found = buckets.get(key);
  if (!found && buckets.size >= MAX_KEYS) return false;
  const b = found ? { ...found } : { tokens: cap, t: now, cap, perMin };
  refill(b, now);
  return b.tokens >= 1;
}

// O(n)
// INV: only full buckets are deleted, so no rate state is lost
export function sweepBuckets(now: number = Date.now()): number {
  let n = 0;
  for (const [k, b] of buckets) {
    refill(b, now);
    if (b.tokens >= b.cap) {
      buckets.delete(k);
      n++;
    }
  }
  return n;
}

setInterval(() => sweepBuckets(), 60_000).unref();
