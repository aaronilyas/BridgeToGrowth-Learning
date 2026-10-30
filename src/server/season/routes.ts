import { seasonOf, type SeasonResponse } from "../../shared/season.ts";
import { json, route } from "../http.ts";

// SEC: no edge headers are trusted; the palette follows the northern year on the server clock
const season = route({}, async () => {
  const hemisphere = "N" as const;
  return json({ season: seasonOf(new Date().getUTCMonth(), hemisphere), hemisphere, source: "default" } satisfies SeasonResponse);
});

export const seasonRoutes = {
  "/api/season": { GET: season },
};
