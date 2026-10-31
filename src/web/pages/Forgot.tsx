import { useState, type FormEvent, type JSX } from "react";
import { Link } from "wouter";
import { z } from "zod";
import { api, describeError } from "../api.ts";
import { Button } from "../components/Button.tsx";
import { Logo } from "../components/Logo.tsx";
import { Panel } from "../components/Panel.tsx";
import { Spinner } from "../components/Spinner.tsx";
import { Turnstile } from "../components/Turnstile.tsx";
import { useSession } from "../session.tsx";

const field = "w-full rounded-xl border border-border bg-panel-2 px-3.5 py-2.5 text-text placeholder:text-muted focus:border-accent focus:outline-none";

// O(1)
export function ForgotPage(): JSX.Element {
  const { config } = useSession();
  const [email, setEmail] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!token) return setError("Please complete the human check.");
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/forgot", z.void(), { method: "POST", body: { email, turnstile: token } });
      setSent(true);
    } catch (err) {
      setError(describeError(err));
      setResetKey((k) => k + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center p-4">
      <Panel className="w-full max-w-md p-8">
        <Logo size={34} />
        <h1 className="mt-6 text-2xl font-semibold">Reset your password</h1>
        {config === null ? (
          <div className="mt-6"><Spinner label="Loading check" /></div>
        ) : !config.passwordReset ? (
          <p className="mt-3 text-sm text-muted">Password reset email is not set up on this server. Sign in, or ask whoever runs the app to set a new password.</p>
        ) : sent ? (
          <p className="mt-3 text-sm text-muted" role="status">If that email has an account, we sent a reset link. It expires in one hour and works once.</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted">We'll email a link if an account uses this address.</p>
            <form className="mt-6 flex flex-col gap-4" onSubmit={(e) => void submit(e)} noValidate>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Email
                <input className={field} type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
              </label>
              <Turnstile siteKey={config.turnstileSiteKey} onToken={setToken} resetKey={resetKey} />
              {error && <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
              <Button type="submit" busy={busy} disabled={!token || !email}>Send reset link</Button>
            </form>
          </>
        )}
        <p className="mt-6 text-center text-sm text-muted">
          <Link href="/login" className="font-medium text-accent hover:underline">Back to sign in</Link>
        </p>
      </Panel>
    </div>
  );
}
