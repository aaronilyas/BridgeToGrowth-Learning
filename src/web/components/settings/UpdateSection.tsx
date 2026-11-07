import { useCallback, useEffect, useState, type JSX } from "react";
import { ReleasesResponse, UpdateStatus, type InstallKind } from "../../../shared/updates.ts";
import { api, makeApiError } from "../../api.ts";
import { openExternalTarget } from "../../openExternal.ts";
import { Button } from "../Button.tsx";
import { Md } from "../Md.tsx";
import { SettingsSection } from "./controls.tsx";
import { ReleaseList } from "./ReleaseList.tsx";
import { describeInstallKind, describeOutcome, describeUpdateError, formatMegabytes, installHintOf, installLabelOf } from "./updateCopy.ts";

const POLL_MS = 500;

// O(1)
function versionOfTag(data: ReleasesResponse | null, tag: string | null): string {
  return data?.releases.find((release) => release.tag === tag)?.version ?? (tag ?? "").replace(/^v/, "");
}

// O(1)
function ProgressPanel({ status, kind, version, onCancel, onInstall }: { status: UpdateStatus; kind: InstallKind; version: string; onCancel: () => void; onInstall: () => void }): JSX.Element | null {
  const share = status.total > 0 ? Math.min(100, Math.round((status.received / status.total) * 100)) : 0;
  if (status.phase === "downloading") {
    return (
      <div className="grid gap-2">
        <p className="text-sm">Downloading version {version}… {formatMegabytes(status.received)} of {formatMegabytes(status.total)}</p>
        <div className="h-2 overflow-hidden rounded-full bg-panel-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={share} aria-label={`Downloading version ${version}`}>
          <div className="h-full bg-accent transition-[width]" style={{ width: `${share}%` }} />
        </div>
        <div><Button variant="soft" onClick={onCancel}>Cancel</Button></div>
      </div>
    );
  }
  if (status.phase === "ready") {
    return (
      <div className="grid gap-2 rounded-lg border border-border bg-panel-2 p-3">
        <p className="text-sm">Version {version} is downloaded, and its checksum matches the one GitHub published.</p>
        {installHintOf(kind) && <p className="text-sm text-muted">{installHintOf(kind)} Your data is backed up first.</p>}
        {status.error && <p role="alert" className="text-sm text-danger">{describeUpdateError(makeApiError(500, status.error))}</p>}
        <div className="flex gap-2">
          <Button onClick={onInstall}>{installLabelOf(kind)}</Button>
          <Button variant="soft" onClick={onCancel}>Discard</Button>
        </div>
      </div>
    );
  }
  if (status.phase === "installing") return <p className="text-sm" role="status">Backing up your data and starting the installer…</p>;
  if (status.phase === "done" && status.outcome) {
    return (
      <div className="grid gap-1 rounded-lg border border-border bg-panel-2 p-3 text-sm" role="status">
        <p>{describeOutcome(kind, status.outcome, version)}</p>
        {status.backup && <p className="text-muted">A copy of your data from before the install is at <span className="break-all font-mono text-xs">{status.backup}</span>.</p>}
      </div>
    );
  }
  if (status.phase === "failed" && status.error) return <p role="alert" className="text-sm text-danger">{describeUpdateError(makeApiError(500, status.error))}</p>;
  return null;
}

// O(n) in releases
export function UpdateSection(): JSX.Element {
  const [data, setData] = useState<ReleasesResponse | null>(null);
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  const checkReleases = useCallback(async (refresh: boolean): Promise<void> => {
    setChecking(true);
    setError("");
    try {
      setData(await api(`/api/updates/releases${refresh ? "?refresh=1" : ""}`, ReleasesResponse));
    } catch (cause) {
      setError(describeUpdateError(cause));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void checkReleases(false);
    void api("/api/updates/download", UpdateStatus).then(setStatus, () => undefined);
  }, [checkReleases]);

  const phase = status?.phase ?? "idle";
  useEffect(() => {
    if (phase !== "downloading" && phase !== "installing") return;
    const timer = setInterval(() => void api("/api/updates/download", UpdateStatus).then(setStatus, () => undefined), POLL_MS);
    return () => clearInterval(timer);
  }, [phase]);

  async function sendUpdate(path: string, method: "POST" | "DELETE", body?: { tag: string }): Promise<void> {
    setError("");
    try {
      setStatus(await api(path, UpdateStatus, { method, ...(body ? { body } : {}) }));
    } catch (cause) {
      setError(describeUpdateError(cause));
    }
  }

  const kind = data?.kind ?? "none";
  const busy = phase === "downloading" || phase === "installing" || phase === "ready" || (phase === "done" && status?.outcome === "quitting");
  const newest = data?.releases[0];
  const upgrade = newest?.relation === "newer" ? newest : null;
  const version = versionOfTag(data, status?.tag ?? null);

  return (
    <SettingsSection title="App version">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <p className="text-sm">You're using version {data?.current ?? "…"}.</p>
          {data && <p className="text-sm text-muted">{describeInstallKind(kind)}</p>}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" busy={checking} onClick={() => void checkReleases(true)}>Check for updates</Button>
          <Button variant="soft" onClick={() => void openExternalTarget("releases").catch((cause: unknown) => setError(describeUpdateError(cause)))}>Releases page</Button>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {data && !upgrade && data.latest !== null && data.releases.some((r) => r.relation === "current") && <p className="text-sm text-muted">You have the latest stable version.</p>}
      {data && data.latest === null && <p className="text-sm text-muted">No stable release has been published on GitHub yet.</p>}
      {upgrade && (phase === "idle" || phase === "failed") && (
        <div className="grid gap-2 rounded-lg border border-accent/50 bg-accent-soft/30 p-3">
          <p className="text-sm font-medium">Version {upgrade.version} is available.</p>
          {upgrade.notes && <Md text={upgrade.notes} className="text-sm" />}
          <div>
            {upgrade.asset?.checksum
              ? <Button onClick={() => void sendUpdate("/api/updates/download", "POST", { tag: upgrade.tag })}>Download {upgrade.version}</Button>
              : <p className="text-sm text-muted">This release has no file for this computer that the app can check, so get it from the releases page.</p>}
          </div>
        </div>
      )}
      {status && <ProgressPanel status={status} kind={kind} version={version} onCancel={() => void sendUpdate("/api/updates/download", "DELETE")} onInstall={() => void sendUpdate("/api/updates/install", "POST", { tag: status.tag ?? "" })} />}
      {data && data.releases.length > 0 && (
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold">All stable versions</h3>
          <p className="text-sm text-muted">To go back to an earlier version, revert to it here. Each download is checked against the SHA-256 checksum GitHub publishes for it.</p>
          <ReleaseList releases={data.releases} current={data.current} disabled={busy} onDownload={(tag) => void sendUpdate("/api/updates/download", "POST", { tag })} />
        </div>
      )}
    </SettingsSection>
  );
}
