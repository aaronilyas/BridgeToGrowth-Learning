import type { JSX } from "react";
import { Link } from "wouter";
import { useSettings } from "../../session.tsx";

// O(1)
export function StaleModelBanner(): JSX.Element | null {
  const { settings } = useSettings();
  if (settings.staleModels.length === 0) return null;
  return (
    <div role="status" className="mb-3 rounded-xl border border-danger/50 bg-panel px-4 py-3 text-sm">
      A saved model is unavailable because its provider was disconnected.{" "}
      <Link href="/settings" className="font-semibold text-accent">Pick a new one in Settings</Link>
    </div>
  );
}
