import { useEffect, useState, type FormEvent, type JSX } from "react";
import { Link, useLocation } from "wouter";
import { AuthUserResponse, ConfigResponse } from "../../shared/api.ts";
import { api, describeError } from "../api.ts";
import { useSession } from "../session.tsx";
import { Button } from "./Button.tsx";
import { Logo } from "./Logo.tsx";
import { Panel } from "./Panel.tsx";
import { Spinner } from "./Spinner.tsx";
import { Turnstile } from "./Turnstile.tsx";

const MIN_PASSWORD = 12;
const field = "w-full rounded-xl border border-border bg-panel-2 px-3.5 py-2.5 text-text placeholder:text-muted focus:border-accent focus:outline-none";

// O(1)
export function AuthForm({ mode }: { mode: "login" | "signup" }): JSX.Element {
  const [, navigate] = useLocation();
  const { refresh } = useSession();
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signup = mode === "signup";

  useEffect(() => {
    api("/api/config", ConfigResponse).then((c) => setSiteKey(c.turnstileSiteKey), (e) => setError(describeError(e)));
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!token) return setError("Please complete the human check.");
    setBusy(true);
    setError(null);
    try {
      await api(signup ? "/api/auth/signup" : "/api/auth/login", AuthUserResponse, { method: "POST", body: { email, password, turnstile: token } });
      await refresh();
      navigate("/teach", { replace: true });
    } catch (err) {
      setError(describeError(err));
      setResetKey((k) => k + 1);
    } finally {
      setBusy(false);
    }
  }

  const short = signup && password.length > 0 && password.length < MIN_PASSWORD;
  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center p-4">
      <Panel className="w-full max-w-md p-8">
        <Logo size={34} />
        <h1 className="mt-6 text-2xl font-semibold">{signup ? "Create your account" : "Welcome back"}</h1>
        <p className="mt-1 text-sm text-muted">{signup ? "Start learning with a free trial. No card needed." : "Sign in to continue learning."}</p>
        <form className="mt-6 flex flex-col gap-4" onSubmit={(e) => void submit(e)} noValidate>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Email
            <input className={field} type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Password
            <input className={field} type="password" autoComplete={signup ? "new-password" : "current-password"} required minLength={signup ? MIN_PASSWORD : 1} maxLength={256} value={password} onChange={(e) => setPassword(e.currentTarget.value)} aria-describedby={signup ? "pw-hint" : undefined} />
            {signup && (
              <span id="pw-hint" className={`text-xs font-normal ${short ? "text-danger" : "text-muted"}`}>
                At least {MIN_PASSWORD} characters{short ? ` (${MIN_PASSWORD - password.length} more)` : ""}.
              </span>
            )}
          </label>
          {siteKey ? <Turnstile siteKey={siteKey} onToken={setToken} resetKey={resetKey} /> : <Spinner label="Loading check" />}
          {error && (
            <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" busy={busy} disabled={!token || !email || (signup ? password.length < MIN_PASSWORD : !password)}>
            {signup ? "Create account" : "Sign in"}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted">
          {signup ? "Already have an account? " : "New here? "}
          <Link href={signup ? "/login" : "/signup"} className="font-medium text-accent hover:underline">
            {signup ? "Sign in" : "Create an account"}
          </Link>
        </p>
      </Panel>
    </div>
  );
}
