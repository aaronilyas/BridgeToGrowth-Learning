import type { SQL } from "bun";
import { sql } from "../db.ts";
import { HttpError } from "../http.ts";
import { jsonText } from "../sqlmap.ts";
import { MASTERED_AT } from "../stats/core.ts";
import { dedupeTopics, resolveEdges, type EdgeIn, type TopicIn } from "./core.ts";

// O(k + e) in topics and edges, two statements
// INV: ids come back in input order; topics are scoped by (user_id, slug); an existing topic keeps its domain and rollups
// INV: WHERE true stops SQLite from parsing ON CONFLICT as a join
export async function upsertTopics(tx: SQL, uid: string, topics: TopicIn[], edges: EdgeIn[]): Promise<string[]> {
  if (topics.length === 0) return [];
  const { rows, rowOf } = dedupeTopics(topics);
  if (rowOf.includes(-1)) throw new HttpError(400, "bad_request");
  const got: { id: string; slug: string }[] = await tx`
    INSERT INTO topics (user_id, slug, name, domain)
    SELECT ${uid}, json_extract(j.value, '$.slug'), json_extract(j.value, '$.name'), json_extract(j.value, '$.domain')
    FROM json_each(${jsonText(rows)}) AS j
    WHERE true
    ON CONFLICT (user_id, slug) DO UPDATE SET name = topics.name
    RETURNING id, slug`;
  const idBySlug = new Map(got.map((g) => [g.slug, g.id]));
  const rowIds = rows.map((r) => idBySlug.get(r.slug) ?? "");
  if (rowIds.includes("")) throw new Error("topic upsert lost a row");
  const pairs = resolveEdges(edges, rowOf, rowIds);
  if (pairs.length > 0) {
    await tx`
      INSERT INTO topic_edges (user_id, src, dst, kind)
      SELECT ${uid}, json_extract(j.value, '$.src'), json_extract(j.value, '$.dst'), json_extract(j.value, '$.kind')
      FROM json_each(${jsonText(pairs)}) AS j
      WHERE true
      ON CONFLICT DO NOTHING`;
  }
  return rowOf.map((r) => rowIds[r] ?? "");
}

// O(limit)
// INV: served by topics(user_id, last_seen_at DESC, id); most recently practised mastered topics first
export async function listMasteredNames(uid: string, limit: number): Promise<string[]> {
  const rows: { name: string }[] = await sql`
    SELECT name FROM topics WHERE user_id = ${uid} AND mastery >= ${MASTERED_AT}
    ORDER BY last_seen_at DESC NULLS LAST LIMIT ${limit}`;
  return rows.map((r) => r.name);
}

// O(k log n)
// INV: served by the (user_id, slug) unique index; returns the subset of slugs the user has mastered
export async function findMasteredSlugs(uid: string, slugs: string[]): Promise<Set<string>> {
  if (slugs.length === 0) return new Set();
  const rows: { slug: string }[] = await sql`
    SELECT slug FROM topics WHERE user_id = ${uid} AND slug IN ${sql(slugs)} AND mastery >= ${MASTERED_AT} LIMIT ${slugs.length}`;
  return new Set(rows.map((r) => r.slug));
}
