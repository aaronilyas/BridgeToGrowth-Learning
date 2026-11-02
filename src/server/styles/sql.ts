import { sql } from "../db.ts";
import { StyleProfile } from "../../shared/api.ts";
import { dateFromMs, jsonText, jsonValue } from "../sqlmap.ts";
import type { StyleMime } from "./core.ts";

export type StyleRow = { id: string; mime: string; profile: unknown; created_at: Date };

// O(log n)
export async function findStyleBySha(uid: string, sha: Buffer): Promise<{ id: string; profile: StyleProfile } | null> {
  const rows: { id: string; profile: unknown }[] = await sql`SELECT id, profile FROM styles WHERE user_id = ${uid} AND sha256 = ${sha} LIMIT 1`;
  const r = rows[0];
  const p = r ? StyleProfile.safeParse(jsonValue(r.profile)) : null;
  return r && p?.success ? { id: r.id, profile: p.data } : null;
}

// O(log n)
export async function findStyleProfile(uid: string, id: string): Promise<StyleProfile | null> {
  const rows: { profile: unknown }[] = await sql`SELECT profile FROM styles WHERE id = ${id} AND user_id = ${uid} LIMIT 1`;
  const p = StyleProfile.safeParse(jsonValue(rows[0]?.profile));
  return p.success ? p.data : null;
}

// O(log n)
export async function countStyles(uid: string): Promise<number> {
  const rows: { n: number }[] = await sql`SELECT count(*) AS n FROM styles WHERE user_id = ${uid}`;
  return rows[0]?.n ?? 0;
}

// O(log n)
// INV: only the profile is stored, never the bytes; a duplicate returns the existing row
export async function insertStyle(uid: string, mime: StyleMime, sha: Buffer, size: number, profile: StyleProfile): Promise<{ id: string; profile: StyleProfile }> {
  const rows: { id: string }[] = await sql`
    INSERT INTO styles (user_id, mime, sha256, size, profile) VALUES (${uid}, ${mime}, ${sha}, ${size}, ${jsonText(profile)})
    ON CONFLICT (user_id, sha256) DO UPDATE SET size = styles.size
    RETURNING id`;
  const id = rows[0]?.id;
  if (!id) throw new Error("style insert returned no row");
  return { id, profile: (await findStyleProfile(uid, id)) ?? profile };
}

// O(limit)
export async function listStyles(uid: string): Promise<StyleRow[]> {
  const rows: { id: string; mime: string; profile: unknown; created_at: number }[] = await sql`
    SELECT id, mime, profile, created_at FROM styles WHERE user_id = ${uid} ORDER BY created_at DESC LIMIT 50`;
  return rows.map((r) => ({ id: r.id, mime: r.mime, profile: jsonValue(r.profile), created_at: dateFromMs(r.created_at) }));
}

// O(log n)
export async function deleteStyle(uid: string, id: string): Promise<boolean> {
  const rows: { id: string }[] = await sql`DELETE FROM styles WHERE id = ${id} AND user_id = ${uid} RETURNING id`;
  return rows.length > 0;
}
