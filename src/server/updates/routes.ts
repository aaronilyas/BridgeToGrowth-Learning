import { ReleaseTagBody, ReleasesQuery } from "../../shared/updates.ts";
import { HttpError, json, route } from "../http.ts";
import { beginReleaseDownload, beginReleaseInstall, cancelReleaseDownload, readReleases, readUpdateStatus } from "./job.ts";

const listReleases = route({ rate: { key: "update-releases", cap: 10, perMin: 10 } }, async (c) => {
  const q = ReleasesQuery.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!q.success) throw new HttpError(400, "bad_request");
  return json(await readReleases(q.data.refresh === "1"));
});

const startDownload = route({ body: ReleaseTagBody, rate: { key: "update-download", cap: 6, perMin: 6 } }, async (c) => json(await beginReleaseDownload(c.body.tag), 202));

const pollUpdate = route({}, async () => json(readUpdateStatus()));

const cancelDownload = route({}, async () => json(cancelReleaseDownload()));

const startInstall = route({ body: ReleaseTagBody, rate: { key: "update-install", cap: 3, perMin: 3 } }, async (c) => json(beginReleaseInstall(c.body.tag), 202));

export const updateRoutes = {
  "/api/updates/releases": { GET: listReleases },
  "/api/updates/download": { POST: startDownload, GET: pollUpdate, DELETE: cancelDownload },
  "/api/updates/install": { POST: startInstall },
};
