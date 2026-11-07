import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ErrorCode } from "../../shared/api.ts";
import type { ReleasesResponse, UpdateOutcome, UpdatePhase, UpdateStatus } from "../../shared/updates.ts";
import { APP_VERSION } from "../../shared/version.ts";
import { HttpError } from "../http.ts";
import { assetNameOf, findReleaseAsset, toReleaseList } from "./core.ts";
import { downloadReleaseAsset, fetchGithubReleases } from "./github.ts";
import { backupBeforeInstall, readAppShell, readInstallKind, runInstaller, updatesDir } from "./install.ts";

type Job = { phase: UpdatePhase; tag: string | null; received: number; total: number; error: ErrorCode | null; outcome: UpdateOutcome | null; backup: string | null; file: string | null; abort: AbortController | null };

const IDLE: Job = { phase: "idle", tag: null, received: 0, total: 0, error: null, outcome: null, backup: null, file: null, abort: null };
const QUIT_DELAY_MS = 1500;

let job: Job = IDLE;

// O(1)
function assetNameHere(): string | null {
  return assetNameOf(process.platform, process.arch, readInstallKind());
}

// O(n log n) in releases; one GitHub call on a cache miss
export async function readReleases(refresh: boolean): Promise<ReleasesResponse> {
  const { releases, at } = await fetchGithubReleases({ refresh });
  const list = toReleaseList(releases, APP_VERSION, assetNameHere());
  return { current: APP_VERSION, kind: readInstallKind(), latest: list[0]?.version ?? null, releases: list, checkedAt: at };
}

// O(1)
// SEC: the local file path stays on the server; the renderer sees only progress, the outcome and the backup path
export function readUpdateStatus(): UpdateStatus {
  return { phase: job.phase, tag: job.tag, received: job.received, total: job.total, error: job.error, outcome: job.outcome, backup: job.backup };
}

// O(1)
function isBusy(): boolean {
  return job.phase === "downloading" || job.phase === "installing" || (job.phase === "done" && job.outcome === "quitting");
}

// O(1)
function errorCodeOf(cause: unknown): ErrorCode {
  return cause instanceof HttpError ? cause.code : "upstream";
}

// O(n) in asset size, run in the background
// INV: a superseded or cancelled job never overwrites the state of the job that replaced it
async function runDownload(current: Job, asset: Parameters<typeof downloadReleaseAsset>[0]["asset"], dest: string): Promise<void> {
  const signal = current.abort?.signal ?? new AbortController().signal;
  try {
    await downloadReleaseAsset({ asset, dest, signal, onProgress: (received) => { if (job === current) job.received = received; } });
    if (job === current) job = { ...current, phase: "ready", received: asset.size, abort: null };
  } catch (cause) {
    if (job !== current) return;
    job = signal.aborted ? IDLE : { ...current, phase: "failed", error: errorCodeOf(cause), abort: null, file: null };
  }
}

// O(1) plus the background download
// INV: one download at a time; earlier downloads are deleted so only the chosen file stays on disk
// SEC: the renderer names a tag, never a URL; the asset comes from GitHub's release list for this repository and must carry a SHA-256 digest
export async function beginReleaseDownload(tag: string): Promise<UpdateStatus> {
  if (isBusy()) throw new HttpError(409, "update_busy");
  const name = assetNameHere();
  if (name === null) throw new HttpError(404, "not_found");
  const { releases } = await fetchGithubReleases({ refresh: false });
  const found = findReleaseAsset(releases, tag, name);
  if (found === null) throw new HttpError(404, "not_found");
  if (isBusy()) throw new HttpError(409, "update_busy");
  const dir = updatesDir();
  const folder = join(dir, found.release.tag.replace(/[^0-9A-Za-z.]/g, "_"));
  await rm(dir, { recursive: true, force: true });
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const dest = join(folder, name);
  const next: Job = { ...IDLE, phase: "downloading", tag: found.release.tag, total: found.asset.size, file: dest, abort: new AbortController() };
  job = next;
  void runDownload(next, found.asset, dest);
  return readUpdateStatus();
}

// O(1)
// INV: only a running download can be cancelled; an install that has started is left to finish
export function cancelReleaseDownload(): UpdateStatus {
  if (job.phase === "downloading") job.abort?.abort();
  if (job.phase !== "installing" && !(job.phase === "done" && job.outcome === "quitting")) job = IDLE;
  return readUpdateStatus();
}

// O(n) in database size plus the installer, run in the background
// INV: a failed install goes back to ready with the error, so the verified file can be installed again without a new download
async function runInstall(current: Job, file: string): Promise<void> {
  try {
    const backup = await backupBeforeInstall();
    if (job === current) job = { ...current, backup };
    const outcome = await runInstaller(readInstallKind(), file);
    job = { ...job, phase: "done", outcome };
    if (outcome === "quitting") setTimeout(() => readAppShell().quit(), QUIT_DELAY_MS);
  } catch (cause) {
    job = { ...job, phase: "ready", error: errorCodeOf(cause), outcome: null };
  }
}

// O(1) plus the background install
// INV: installs only the verified file of the named, already downloaded release; the database is backed up first
export function beginReleaseInstall(tag: string): UpdateStatus {
  const file = job.file;
  if (job.phase === "installing" || job.phase === "downloading") throw new HttpError(409, "update_busy");
  if (job.phase !== "ready" || job.tag !== tag || file === null) throw new HttpError(404, "not_found");
  const current: Job = { ...job, phase: "installing", error: null };
  job = current;
  void runInstall(current, file);
  return readUpdateStatus();
}
