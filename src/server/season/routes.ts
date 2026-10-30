import { hemisphereOf, seasonOf, type SeasonResponse } from "../../shared/season.ts";
import { json, route } from "../http.ts";

// SEC: cf-ip* headers are trustworthy only because cloudflared is the only ingress; worst case a spoofed header picks the wrong palette
const season = route({}, async (c) => {
  const { h, source } = hemisphereOf(c.req.headers.get("cf-iplatitude"), c.req.headers.get("cf-ipcountry"));
  return json({ season: seasonOf(new Date().getUTCMonth(), h), hemisphere: h, source } satisfies SeasonResponse);
});

export const seasonRoutes = {
  "/api/season": { GET: season },
};
