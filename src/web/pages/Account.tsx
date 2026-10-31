import { useState, type FormEvent, type JSX } from "react";
import { useLocation } from "wouter";
import { z } from "zod";
import { AuthUserResponse, MIN_PASSWORD } from "../../shared/api.ts";
import { api, describeError } from "../api.ts";
import { Button } from "../components/Button.tsx";
import { Panel } from "../components/Panel.tsx";
import { useMe, useSession } from "../session.tsx";

const field = "w-full rounded-lg border border-border bg-panel-2 px-3 py-2 text-text";

// O(1)
export function AccountPage(): JSX.Element {
  const me = useMe();
  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <header>
        <h1 className="text-2xl font-semibold">Account</h1>
        <p className="mt-1 text-sm text-muted">{me.email}</p>
      </header>
      <PasswordSection />
      <DeleteSection />
    </div>
  );
}

function PasswordSection(): JSX.Element {
  const { refresh } = useSession();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const short = newPassword.length > 0 && newPassword.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && confirm !== newPassword;
  const same = newPassword.length > 0 && newPassword === currentPassword;

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (short || mismatch || same || newPassword.length < MIN_PASSWORD) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await api("/api/auth/password", AuthUserResponse, { method: "POST", body: { currentPassword, newPassword } });
      await refresh();
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      setMessage("Password updated. Other signed-in devices were signed out.");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <h2 className="text-lg font-semibold">Password</h2>
      <p className="mt-1 text-sm text-muted">Choose a new password of at least {MIN_PASSWORD} characters.</p>
      <form className="mt-4 grid max-w-md gap-4" onSubmit={(e) => void submit(e)} noValidate>
        <label className="grid gap-1 text-sm">
          Current password
          <input className={field} type="password" autoComplete="current-password" required maxLength={256} value={currentPassword} onChange={(e) => setCurrentPassword(e.currentTarget.value)} />
        </label>
        <label className="grid gap-1 text-sm">
          New password
          <input className={field} type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} maxLength={256} value={newPassword} onChange={(e) => setNewPassword(e.currentTarget.value)} aria-describedby="pw-hint" />
          <span id="pw-hint" className={`text-xs ${short || same ? "text-danger" : "text-muted"}`}>
            {same ? "Choose a different password." : `At least ${MIN_PASSWORD} characters${short ? ` (${MIN_PASSWORD - newPassword.length} more)` : ""}.`}
          </span>
        </label>
        <label className="grid gap-1 text-sm">
          Confirm new password
          <input className={field} type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} maxLength={256} value={confirm} onChange={(e) => setConfirm(e.currentTarget.value)} aria-describedby={mismatch ? "pw-mismatch" : undefined} />
          {mismatch && <span id="pw-mismatch" className="text-xs text-danger">Those passwords don't match.</span>}
        </label>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {message && <p role="status" className="text-sm text-muted">{message}</p>}
        <div>
          <Button type="submit" busy={busy} disabled={!currentPassword || newPassword.length < MIN_PASSWORD || confirm !== newPassword || same}>Update password</Button>
        </div>
      </form>
    </Panel>
  );
}

function DeleteSection(): JSX.Element {
  const [, navigate] = useLocation();
  const { signOut } = useSession();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/account", z.void(), { method: "DELETE", body: { password } });
      await signOut();
      navigate("/login", { replace: true });
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  }

  return (
    <Panel>
      <h2 className="text-lg font-semibold">Delete account</h2>
      <p className="mt-1 text-sm text-muted">This permanently deletes your lessons, practice history, and settings. A Pro subscription is canceled immediately.</p>
      {confirming ? (
        <form className="mt-4 grid max-w-md gap-4" onSubmit={(e) => void remove(e)} noValidate>
          <label className="grid gap-1 text-sm">
            Password
            <input className={field} type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
          </label>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" busy={busy} disabled={!password}>Delete account permanently</Button>
            <Button variant="ghost" disabled={busy} onClick={() => { setConfirming(false); setError(""); }}>Cancel</Button>
          </div>
        </form>
      ) : (
        <div className="mt-4">
          <Button variant="danger" onClick={() => setConfirming(true)}>Delete account</Button>
        </div>
      )}
    </Panel>
  );
}
