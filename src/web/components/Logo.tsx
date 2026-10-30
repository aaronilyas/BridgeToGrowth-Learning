import type { JSX } from "react";

// O(1)
export function Logo({ size = 30 }: { size?: number }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 24C9 14 23 14 29 24" stroke="var(--accent)" strokeWidth="2.4" />
        <path d="M3 24H29M9 24V19.5M16 24V17M23 24V19.5" stroke="var(--accent)" strokeWidth="2" />
        <path d="M16 15V7" stroke="var(--accent-2)" strokeWidth="2" />
        <path d="M16 10C16 6 13 4 9.5 4.5C10 8 12.5 10 16 10ZM16 8.5C16 5 19 3 22.5 3.5C22 7 19.5 8.5 16 8.5Z" fill="var(--accent-2)" />
      </svg>
      <span className="text-lg font-semibold tracking-tight text-text">
        BridgeTo<span className="text-accent">Growth</span>
      </span>
    </span>
  );
}
