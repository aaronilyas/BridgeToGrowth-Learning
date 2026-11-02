import { useState, type JSX } from "react";
import { describeError, readApiError, readLaunchHeaders } from "../../api.ts";
import { Button } from "../Button.tsx";
import { fieldClass, SettingsSection } from "./controls.tsx";

// O(n) in the zip size
async function downloadDataExport(): Promise<void> {
  const res = await fetch("/api/data/export", { headers: readLaunchHeaders() });
  if (!res.ok) throw await readApiError(res);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "bridgetogrowth.zip";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// O(1)
export function DataSection({ email, onEmail }: { email: string; onEmail: (value: string) => void }): JSX.Element {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [phrase, setPhrase] = useState("");
  const [wiping, setWiping] = useState(false);
  const [wipeError, setWipeError] = useState("");

  async function saveDatabaseExport(): Promise<void> {
    setExporting(true);
    setExportError("");
    try {
      await downloadDataExport();
    } catch (cause) {
      setExportError(describeError(cause));
    } finally {
      setExporting(false);
    }
  }

  async function eraseAllData(): Promise<void> {
    if (phrase !== "delete") return;
    setWiping(true);
    setWipeError("");
    try {
      const res = await fetch("/api/data", { method: "DELETE", headers: readLaunchHeaders() });
      if (!res.ok) throw await readApiError(res);
      window.location.reload();
    } catch (cause) {
      setWipeError(describeError(cause));
      setWiping(false);
    }
  }

  return (
    <SettingsSection title="Data">
      <label className="grid gap-1 text-sm">
        OpenAlex contact email
        <input className={fieldClass} type="email" maxLength={254} autoComplete="email" value={email} placeholder="Optional" aria-label="OpenAlex contact email" onChange={(event) => onEmail(event.currentTarget.value)} />
        <span className="text-xs text-muted">Optional. Paper search sends this address to OpenAlex so they can reach you about use of their catalog. It is saved with the other settings.</span>
      </label>
      <div className="grid gap-2">
        <p className="text-sm text-muted">Download a zip of the local database. Provider keys stay in the keychain and are not included.</p>
        <div>
          <Button variant="soft" busy={exporting} onClick={() => void saveDatabaseExport()}>Export</Button>
        </div>
        {exportError && <p role="alert" className="text-sm text-danger">{exportError}</p>}
      </div>
      <div className="grid gap-2">
        <p className="text-sm text-muted">Delete every lesson, question, and setting on this computer, and remove stored provider keys. Type delete to confirm.</p>
        <label className="grid max-w-xs gap-1 text-sm">
          Confirmation
          <input className={fieldClass} value={phrase} aria-label="Type delete to confirm" onChange={(event) => setPhrase(event.currentTarget.value)} />
        </label>
        <div>
          <Button variant="danger" busy={wiping} disabled={phrase !== "delete"} onClick={() => void eraseAllData()}>Delete all data</Button>
        </div>
        {wipeError && <p role="alert" className="text-sm text-danger">{wipeError}</p>}
      </div>
    </SettingsSection>
  );
}
