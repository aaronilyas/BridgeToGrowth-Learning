import type { JSX } from "react";
import { fieldClass, SettingsSection } from "./controls.tsx";

// O(1)
export function BudgetField({ value, onChange }: { value: number | null; onChange: (value: number | null) => void }): JSX.Element {
  return (
    <SettingsSection title="Budget" hint="Optional monthly USD budget. Applies to OpenRouter only.">
      <label className="grid max-w-xs gap-1 text-sm">
        Monthly budget (USD)
        <input
          className={fieldClass}
          type="number"
          min={0}
          max={1_000_000}
          step="0.01"
          inputMode="decimal"
          aria-label="Monthly budget in USD, applies to OpenRouter only"
          value={value ?? ""}
          placeholder="No limit"
          onChange={(event) => {
            const raw = event.currentTarget.value;
            if (raw.trim() === "") {
              onChange(null);
              return;
            }
            const next = Number(raw);
            if (!Number.isFinite(next)) return;
            onChange(Math.min(1_000_000, Math.max(0, next)));
          }}
        />
      </label>
    </SettingsSection>
  );
}
