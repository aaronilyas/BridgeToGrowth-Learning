import { z } from "zod";
import { StyleProfile } from "../../shared/api.ts";
import { HttpError, json, route } from "../http.ts";
import { chatJson } from "../llm/gateway.ts";
import { localProfile } from "../profile.ts";
import { MAX_STYLES, MAX_UPLOAD, STYLE_SYSTEM, acceptUpload, toFilePart } from "./core.ts";
import { countStyles, deleteStyle, findStyleBySha, insertStyle, listStyles } from "./sql.ts";

const IdParams = z.strictObject({ id: z.uuid() });

const upload = route({ raw: true, maxBody: MAX_UPLOAD, rate: { key: "style", cap: 5, perMin: 5 } }, async (c) => {
  const uid = (await localProfile()).id;
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw new HttpError(400, "bad_request");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "bad_request");
  if (file.size > MAX_UPLOAD) throw new HttpError(413, "too_large");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = acceptUpload(bytes.subarray(0, 8), file.type);
  const sha = Buffer.from(new Bun.CryptoHasher("sha256").update(bytes).digest());
  const existing = await findStyleBySha(uid, sha);
  if (existing) return json({ styleId: existing.id, profile: existing.profile });
  if ((await countStyles(uid)) >= MAX_STYLES) throw new HttpError(400, "bad_request");
  const r = await chatJson({
    who: { uid },
    model: { system: "extract" },
    kind: "style",
    system: STYLE_SYSTEM,
    user: "Describe the style of the attached questions.",
    schema: StyleProfile,
    maxTokens: 1200,
    files: [toFilePart(mime, bytes)],
  });
  const row = await insertStyle(uid, mime, sha, bytes.length, r.data);
  return json({ styleId: row.id, profile: row.profile });
});

const list = route({}, async () => {
  const rows = await listStyles((await localProfile()).id);
  return json(rows.map((r) => ({ id: r.id, subject: StyleProfile.safeParse(r.profile).data?.subject ?? "", mime: r.mime, createdAt: r.created_at.toISOString() })));
});

const remove = route({}, async (c) => {
  const p = IdParams.safeParse(c.params);
  if (!p.success || !(await deleteStyle((await localProfile()).id, p.data.id))) throw new HttpError(404, "not_found");
  return new Response(null, { status: 204 });
});

export const styleRoutes = {
  "/api/styles": { GET: list, POST: upload },
  "/api/styles/:id": { DELETE: remove },
};
