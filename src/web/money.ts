const usd = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });

// O(1)
export function formatMicros(micros: number): string {
  return usd.format(micros / 1e6);
}

// O(1)
export function formatCents(cents: number): string {
  return usd.format(cents / 100);
}
