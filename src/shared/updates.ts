import { z } from "zod";

// INV: "none" is a development build or a copy the app did not install itself; it can download a release and show it in a folder, but not install it
export const InstallKind = z.enum(["windows", "macos", "deb", "appimage", "none"]);
export type InstallKind = z.infer<typeof InstallKind>;

export const ReleaseRelation = z.enum(["newer", "current", "older"]);
export type ReleaseRelation = z.infer<typeof ReleaseRelation>;

// INV: checksum is false when GitHub published no SHA-256 digest for the file; such a file is never downloaded
export const ReleaseAsset = z.strictObject({ name: z.string(), size: z.int().min(0), checksum: z.boolean() });
export type ReleaseAsset = z.infer<typeof ReleaseAsset>;

export const ReleaseInfo = z.strictObject({
  tag: z.string(),
  version: z.string(),
  name: z.string(),
  publishedAt: z.string().nullable(),
  notes: z.string(),
  url: z.string(),
  asset: ReleaseAsset.nullable(),
  relation: ReleaseRelation,
});
export type ReleaseInfo = z.infer<typeof ReleaseInfo>;

// INV: releases are stable only (no drafts, prereleases or non x.y.z tags), newest first; latest is the newest stable version, or null when none is published
export const ReleasesResponse = z.strictObject({
  current: z.string(),
  kind: InstallKind,
  latest: z.string().nullable(),
  releases: z.array(ReleaseInfo),
  checkedAt: z.int(),
});
export type ReleasesResponse = z.infer<typeof ReleasesResponse>;

export const ReleasesQuery = z.strictObject({ refresh: z.literal("1").optional() });
export type ReleasesQuery = z.infer<typeof ReleasesQuery>;

export const ReleaseTagBody = z.strictObject({ tag: z.string().regex(/^v?\d{1,6}\.\d{1,6}\.\d{1,6}$/) });
export type ReleaseTagBody = z.infer<typeof ReleaseTagBody>;

export const UpdatePhase = z.enum(["idle", "downloading", "ready", "installing", "done", "failed"]);
export type UpdatePhase = z.infer<typeof UpdatePhase>;

// INV: quitting = the app closes so the installer (or the relaunched new version) takes over; opened = an installer window is open for the user to finish; revealed = the file is shown in a folder
export const UpdateOutcome = z.enum(["quitting", "opened", "revealed"]);
export type UpdateOutcome = z.infer<typeof UpdateOutcome>;

export const UpdateStatus = z.strictObject({
  phase: UpdatePhase,
  tag: z.string().nullable(),
  received: z.int().min(0),
  total: z.int().min(0),
  error: z.string().nullable(),
  outcome: UpdateOutcome.nullable(),
  backup: z.string().nullable(),
});
export type UpdateStatus = z.infer<typeof UpdateStatus>;
