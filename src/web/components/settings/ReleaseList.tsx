import { useState, type JSX } from "react";
import type { ReleaseInfo } from "../../../shared/updates.ts";
import { Button } from "../Button.tsx";
import { Md } from "../Md.tsx";
import { formatMegabytes, formatReleaseDate } from "./updateCopy.ts";

const RELATION_TEXT: Record<ReleaseInfo["relation"], string> = { newer: "Newer", current: "Installed", older: "Older" };

// O(1)
function unavailableReason(release: ReleaseInfo): string | null {
  if (release.asset === null) return "Not built for this computer.";
  if (!release.asset.checksum) return "GitHub has no checksum for this file, so the app won't download it. Get it from the releases page instead.";
  return null;
}

// O(1)
function ReleaseRow({ release, current, disabled, onDownload }: { release: ReleaseInfo; current: string; disabled: boolean; onDownload: (tag: string) => void }): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const reason = unavailableReason(release);
  const date = formatReleaseDate(release.publishedAt);
  const older = release.relation === "older";
  return (
    <li className="grid gap-2 border-t border-border py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{release.version}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs ${release.relation === "current" ? "bg-accent-soft text-text" : "bg-panel-2 text-muted"}`}>{RELATION_TEXT[release.relation]}</span>
        {date && <span className="text-xs text-muted">{date}</span>}
        {release.asset && <span className="text-xs text-muted">{formatMegabytes(release.asset.size)}</span>}
        <span className="ml-auto">
          {release.relation !== "current" && reason === null && !confirming && (
            <Button variant={older ? "ghost" : "primary"} disabled={disabled} onClick={() => (older ? setConfirming(true) : onDownload(release.tag))}>
              {older ? `Revert to ${release.version}` : `Download ${release.version}`}
            </Button>
          )}
        </span>
      </div>
      {release.relation !== "current" && reason !== null && <p className="text-xs text-muted">{reason}</p>}
      {confirming && (
        <div className="grid gap-2 rounded-lg border border-border bg-panel-2 p-3 text-sm" role="group" aria-label={`Confirm reverting to ${release.version}`}>
          <p>Install version {release.version} in place of version {current}?</p>
          <p className="text-muted">Your data is backed up before the older version is installed. Anything that depends on features newer than {release.version} may be missing or look different until you update again, which you can do here at any time.</p>
          <div className="flex gap-2">
            <Button variant="danger" disabled={disabled} onClick={() => { setConfirming(false); onDownload(release.tag); }}>Download {release.version}</Button>
            <Button variant="soft" onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        </div>
      )}
      {release.notes && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted hover:text-text">Release notes</summary>
          <Md text={release.notes} className="mt-2 text-sm" />
        </details>
      )}
    </li>
  );
}

// O(n) in releases
export function ReleaseList({ releases, current, disabled, onDownload }: { releases: readonly ReleaseInfo[]; current: string; disabled: boolean; onDownload: (tag: string) => void }): JSX.Element {
  return (
    <ul className="grid">
      {releases.map((release) => <ReleaseRow key={release.tag} release={release} current={current} disabled={disabled} onDownload={onDownload} />)}
    </ul>
  );
}
