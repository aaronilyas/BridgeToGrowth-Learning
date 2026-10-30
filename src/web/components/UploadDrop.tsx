import { useRef, useState, type DragEvent, type JSX } from "react";
import { StyleUploaded } from "../../shared/api.ts";
import { api, makeApiError } from "../api.ts";
import { ErrorBanner } from "./ErrorBanner.tsx";
import { Spinner } from "./Spinner.tsx";

const MAX_BYTES = 10 * 1024 * 1024;
const EXT = /\.(pdf|png)$/i;

// O(1)
export function UploadDrop({ onUploaded }: { onUploaded: (styleId: string, subject: string) => void }): JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const send = async (file: File): Promise<void> => {
    setError(null);
    if (!EXT.test(file.name)) return setError(makeApiError(415, "unsupported_media"));
    if (file.size > MAX_BYTES) return setError(makeApiError(413, "too_large"));
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const r = await api("/api/styles", StyleUploaded, { method: "POST", body: form });
      onUploaded(r.styleId, r.profile.subject);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) void send(f);
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-1 rounded-xl border border-dashed px-4 py-5 text-center text-sm ${over ? "border-accent bg-accent-soft" : "border-border bg-panel-2"}`}
      >
        {busy ? (
          <Spinner size={16} label="Reading the style…" />
        ) : (
          <>
            <p className="text-text">Mimic a question style</p>
            <p className="text-muted">Drop a PDF or PNG (max 10 MB), or</p>
            <button type="button" className="font-semibold text-accent underline" onClick={() => input.current?.click()}>
              choose a file
            </button>
          </>
        )}
        <input ref={input} type="file" accept=".pdf,.png,application/pdf,image/png" className="sr-only" aria-label="Upload a PDF or PNG" onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          if (f) void send(f);
        }} />
      </div>
      <ErrorBanner error={error} />
    </div>
  );
}
