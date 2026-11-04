import { useState, type JSX } from "react";
import { z } from "zod";
import { ConnectionStatus, type ConnectionStatus as ConnectionRow } from "../../../shared/providers.ts";
import { api, describeError, isApiError } from "../../api.ts";
import { openExternalTarget } from "../../openExternal.ts";
import { keyNoteOf, titleOfProvider } from "../../providerCopy.ts";
import { Button } from "../Button.tsx";
import { Panel } from "../Panel.tsx";

const fieldClass = "w-full rounded-lg border border-border bg-panel-2 px-3 py-2 text-text outline-none focus:border-accent";

// O(1)
function keyStatusLine(status: ConnectionRow): string {
  if (status.connected) return status.last4 ? `Connected · ••••${status.last4}` : "Connected";
  if (status.detail === "unreachable") return "The provider could not be reached.";
  if (status.last4) return `Saved key was rejected · ••••${status.last4}`;
  return "Not connected";
}

// O(1)
export function KeyCard({ status, onChanged }: { status: ConnectionRow; onChanged: () => Promise<void> }): JSX.Element {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState("");
  const stored = status.connected || status.last4 !== undefined;
  const title = titleOfProvider(status.provider);

  async function submitProviderKey(event: { preventDefault: () => void }): Promise<void> {
    event.preventDefault();
    const submitted = key;
    setKey("");
    if (submitted.trim() === "") return;
    setBusy("save");
    setError("");
    try {
      await api(`/api/providers/${status.provider}/key`, ConnectionStatus, { method: "PUT", body: { key: submitted } });
      await onChanged();
    } catch (cause) {
      setError(isApiError(cause) && cause.status === 422 ? "That key was rejected (422). Check it and try again." : describeError(cause));
    } finally {
      setBusy(null);
    }
  }

  async function clearProviderKey(): Promise<void> {
    setBusy("remove");
    setError("");
    try {
      await api(`/api/providers/${status.provider}/key`, z.undefined(), { method: "DELETE" });
      await onChanged();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted">API key. {title} bills your own provider account for each use. {keyNoteOf(status.provider)}</p>
      <div className="mt-3">
        <Button variant="soft" onClick={() => void openExternalTarget(status.provider === "spacexai" ? "spacexai_keys" : "openrouter_keys").catch((cause: unknown) => setError(describeError(cause)))}>
          Get a {title} key
        </Button>
      </div>
      <p className="mt-3 text-sm">{keyStatusLine(status)}</p>
      <form className="mt-3 flex flex-col gap-3 sm:flex-row" onSubmit={(event) => void submitProviderKey(event)}>
        <input
          type="password"
          className={fieldClass}
          value={key}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-label={`${title} API key`}
          placeholder="Paste an API key"
          onChange={(event) => setKey(event.currentTarget.value)}
        />
        <Button type="submit" busy={busy === "save"} disabled={key.trim() === "" || busy !== null}>
          {busy === "save" ? "Checking key…" : "Save"}
        </Button>
      </form>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      {stored && (
        <div className="mt-3">
          <Button variant="danger" busy={busy === "remove"} disabled={busy !== null} onClick={() => void clearProviderKey()}>
            Remove
          </Button>
        </div>
      )}
    </Panel>
  );
}
