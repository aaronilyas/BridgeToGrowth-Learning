import type { SQL } from "bun";
import { HttpError } from "../http.ts";
import { dedupeTopics, resolveEdges, type EdgeIn, type TopicIn } from "./core.ts";

// O(k + e) in topics and edges, two statements
// INV: ids come back in input order; topics are scoped by (user_id, slug); an existing topic keeps its domain and rollups
export async function upsertTopics(tx: SQL, uid: string, topics: TopicIn[], edges: EdgeIn[]): Promise<string[]> {
  if (topics.length === 0) return [];
  const { rows, rowOf } = dedupeTopics(topics);
  if (rowOf.includes(-1)) throw new HttpError(400, "bad_request");
  const got: { id: string; slug: string }[] = await tx`
    INSERT INTO topics (user_id, slug, name, domain)
    SELECT ${uid}, t.slug, t.name, t.domain FROM unnest(${rows.map((r) => r.slug)}::text[], ${rows.map((r) => r.name)}::text[], ${rows.map((r) => r.domain)}::text[]) AS t(slug, name, domain)
    ON CONFLICT (user_id, slug) DO UPDATE SET name = topics.name
    RETURNING id, slug`;
  const idBySlug = new Map(got.map((g) => [g.slug, g.id]));
  const rowIds = rows.map((r) => idBySlug.get(r.slug) ?? "");
  if (rowIds.includes("")) throw new Error("topic upsert lost a row");
  const pairs = resolveEdges(edges, rowOf, rowIds);
  if (pairs.length > 0) {
    await tx`
      INSERT INTO topic_edges (user_id, src, dst, kind)
      SELECT ${uid}, e.src, e.dst, e.kind FROM unnest(${pairs.map((p) => p.src)}::uuid[], ${pairs.map((p) => p.dst)}::uuid[], ${pairs.map((p) => p.kind)}::text[]) AS e(src, dst, kind)
      ON CONFLICT DO NOTHING`;
  }
  return rowOf.map((r) => rowIds[r] ?? "");
}
