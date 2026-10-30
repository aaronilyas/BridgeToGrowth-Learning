import type { ButtonHTMLAttributes, JSX } from "react";
import { Spinner } from "./Spinner.tsx";

export type ButtonVariant = "primary" | "ghost" | "soft" | "danger";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent hover:brightness-110 border-transparent",
  soft: "bg-accent-soft text-accent border-accent/40 hover:bg-accent/25",
  ghost: "bg-transparent text-text border-border hover:bg-panel-2",
  danger: "bg-transparent text-danger border-danger/50 hover:bg-danger/10",
};

// O(1)
export function Button({ variant = "primary", busy = false, className = "", children, disabled, type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; busy?: boolean }): JSX.Element {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {busy && <Spinner size={14} />}
      {children}
    </button>
  );
}
