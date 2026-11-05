import type { JSX } from "react";
import { Link } from "wouter";
import { useSettings } from "../../session.tsx";

// O(1)
export function StaleModelBanner(): JSX.Element | null {
  const { settings } = useSettings();
  if (settings.staleModels.length === 0) return null;
  return (
    <div role="status" className="mx-8 mt-3 rounded-lg border border-danger/50 bg-panel px-3 py-2 text-sm">
      A saved model is unavailable because its provider was disconnected.{" "}
      <Link href="/settings" className="font-semibold text-accent">Pick a new one in Settings</Link>
    </div>
  );
}
