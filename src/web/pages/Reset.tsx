import { useState, type FormEvent, type JSX } from "react";
import { Link, useLocation } from "wouter";
import { AuthUserResponse, MIN_PASSWORD, RESET_TOKEN } from "../../shared/api.ts";
import { api, describeError, isApiError } from "../api.ts";
import { Button } from "../components/Button.tsx";
import { Logo } from "../components/Logo.tsx";
import { Panel } from "../components/Panel.tsx";
import { useSession } from "../session.tsx";

const field = "w-full rounded-xl border border-border bg-panel-2 px-3.5 py-2.5 text-text placeholder:text-muted focus:border-accent focus:outline-none";

function readResetToken(): string {
  const raw = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function resetMessage(error: unknown): string {
  if (isApiError(error) && error.status === 400) return "This reset link is invalid or has expired. Request a new one.";
  return describeError(error);
}

// O(1)
export function ResetPage(): JSX.Element {
  const [, navigate] = useLocation();
  const { refresh } = useSession();
  const [token] = useState(readResetToken);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(RESET_TOKEN.test(token) ? null : "This reset link is invalid or has expired. Request a new one.");
  const valid = RESET_TOKEN.test(token);
  const short = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && confirm !== password;

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!valid || password.length < MIN_PASSWORD || password !== confirm) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/reset", AuthUserResponse, { method: "POST", body: { token, password } });
      window.history.replaceState(null, "", "/reset");
      await refresh();
      navigate("/teach", { replace: true });
    } catch (err) {
      setError(resetMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center p-4">
      <Panel className="w-full max-w-md p-8">
        <Logo size={34} />
        <h1 className="mt-6 text-2xl font-semibold">Choose a new password</h1>
        {valid ? (
          <form className="mt-6 flex flex-col gap-4" onSubmit={(e) => void submit(e)} noValidate>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              New password
              <input className={field} type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} maxLength={256} value={password} onChange={(e) => setPassword(e.currentTarget.value)} aria-describedby="pw-hint" />
              <span id="pw-hint" className={`text-xs font-normal ${short ? "text-danger" : "text-muted"}`}>
                At least {MIN_PASSWORD} characters{short ? ` (${MIN_PASSWORD - password.length} more)` : ""}.
              </span>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Confirm new password
              <input className={field} type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} maxLength={256} value={confirm} onChange={(e) => setConfirm(e.currentTarget.value)} />
              {mismatch && <span className="text-xs font-normal text-danger">Those passwords don't match.</span>}
            </label>
            {error && <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
            <Button type="submit" busy={busy} disabled={password.length < MIN_PASSWORD || password !== confirm}>Update password</Button>
          </form>
        ) : (
          error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>
        )}
        <p className="mt-6 text-center text-sm text-muted">
          <Link href="/forgot" className="font-medium text-accent hover:underline">Request a new link</Link>
          <span className="mx-2">·</span>
          <Link href="/login" className="font-medium text-accent hover:underline">Sign in</Link>
        </p>
      </Panel>
    </div>
  );
}
