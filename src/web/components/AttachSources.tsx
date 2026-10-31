import { useRef, useState, type JSX } from "react";
import { MAX_LESSON_URLS } from "../../shared/api.ts";

export const MAX_ATTACH_FILES = 3;
export const MAX_ATTACH_BYTES = 25 * 1024 * 1024;

export type Attachments = { files: File[]; urls: string[] };

// O(1)
function checkLink(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// O(n) in attachments
// INV: client-side limits mirror the server (3 PDFs of at most 25 MB, 3 http(s) links); the server re-checks everything
export function AttachSources({ value, onChange, disabled }: { value: Attachments; onChange: (next: Attachments) => void; disabled: boolean }): JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const addFiles = (list: FileList | null): void => {
    setNote(null);
    const picked = [...(list ?? [])];
    const ok = picked.filter((f) => f.type === "application/pdf" && /\.pdf$/i.test(f.name) && f.size <= MAX_ATTACH_BYTES);
    if (ok.length < picked.length) setNote("Only PDF files up to 25 MB can be attached.");
    const files = [...value.files, ...ok].slice(0, MAX_ATTACH_FILES);
    if (value.files.length + ok.length > MAX_ATTACH_FILES) setNote(`At most ${MAX_ATTACH_FILES} PDFs.`);
    onChange({ ...value, files });
    if (input.current) input.current.value = "";
  };

  const addLink = (): void => {
    const url = checkLink(link);
    if (!url) return setNote("Enter a full http:// or https:// link.");
    if (value.urls.length >= MAX_LESSON_URLS) return setNote(`At most ${MAX_LESSON_URLS} links.`);
    setNote(null);
    setLink("");
    if (!value.urls.includes(url)) onChange({ ...value, urls: [...value.urls, url] });
  };

  const chip = "flex max-w-full items-center gap-2 rounded-full border border-border bg-panel-2 px-3 py-1 text-xs";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={disabled || value.files.length >= MAX_ATTACH_FILES} onClick={() => input.current?.click()} className="rounded-xl border border-border px-3 py-2 text-sm text-muted transition hover:text-text disabled:opacity-50">
          Attach PDF
        </button>
        <input ref={input} type="file" multiple accept=".pdf,application/pdf" className="sr-only" aria-label="Attach PDFs" onChange={(e) => addFiles(e.currentTarget.files)} />
        <input
          className="min-w-48 flex-1 rounded-xl border border-border bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent"
          placeholder="Add a link for context (https://…)"
          aria-label="Add a link for context"
          type="url"
          maxLength={2048}
          value={link}
          disabled={disabled || value.urls.length >= MAX_LESSON_URLS}
          onChange={(e) => setLink(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addLink();
            }
          }}
        />
        <button type="button" disabled={disabled || link.trim() === ""} onClick={addLink} className="rounded-xl border border-border px-3 py-2 text-sm text-muted transition hover:text-text disabled:opacity-50">
          Add link
        </button>
      </div>
      {(value.files.length > 0 || value.urls.length > 0) && (
        <ul className="flex flex-wrap gap-2" aria-label="Attached context">
          {value.files.map((f, i) => (
            <li key={`f${i}-${f.name}`} className={chip}>
              <span className="truncate">{f.name}</span>
              <span className="text-muted">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
              <button type="button" disabled={disabled} aria-label={`Remove ${f.name}`} className="text-muted hover:text-danger" onClick={() => onChange({ ...value, files: value.files.filter((_, j) => j !== i) })}>
                ×
              </button>
            </li>
          ))}
          {value.urls.map((u) => (
            <li key={u} className={chip}>
              <span className="truncate">{u}</span>
              <button type="button" disabled={disabled} aria-label={`Remove ${u}`} className="text-muted hover:text-danger" onClick={() => onChange({ ...value, urls: value.urls.filter((x) => x !== u) })}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {note && <p className="text-xs text-danger">{note}</p>}
      {(value.files.length > 0 || value.urls.length > 0) && <p className="text-xs text-muted">Attachments are read once while planning the lesson and are not saved. Practice ignores them.</p>}
    </div>
  );
}
