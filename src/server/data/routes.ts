import { sql } from "../db.ts";
import { deleteAppRows } from "./sql.ts";
import { exportDatabaseZip } from "./export.ts";
import { route } from "../http.ts";
import { deleteProviderKey } from "../secrets.ts";

const exportData = route({}, async () => {
  const bytes = await exportDatabaseZip();
  return new Response(Buffer.from(bytes), { headers: { "content-type": "application/zip", "content-disposition": "attachment; filename=\"bridgetogrowth.zip\"", "cache-control": "no-store" } });
});

const wipeData = route({}, async () => {
  await sql.begin(async (tx) => {
    await deleteAppRows(tx);
  });
  await deleteProviderKey("openrouter");
  await deleteProviderKey("codex");
  await deleteProviderKey("spacexai");
  return new Response(null, { status: 204 });
});

export const dataRoutes = {
  "/api/data/export": { GET: exportData },
  "/api/data": { DELETE: wipeData },
};
