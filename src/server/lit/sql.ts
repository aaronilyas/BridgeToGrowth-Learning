import { sql } from "../db.ts";
import type { Paper } from "./core.ts";

type PaperRow = { id: string; doi: string | null; title: string; year: number | null; venue: string | null; abstract: string | null };

// O(k)
// INV: a hit is fresher than 7 days; papers come back in the stored order
export async function findCached(qhash: Buffer): Promise<Paper[] | null> {
  const rows: { paper_ids: string[] }[] = await sql`
    SELECT paper_ids FROM retrieval_cache WHERE qhash = ${qhash} AND fetched_at > now() - interval '7 days' LIMIT 1`;
  const ids = rows[0]?.paper_ids;
  if (!ids) return null;
  const ps: PaperRow[] = await sql`SELECT id, doi, title, year, venue, abstract FROM papers WHERE id = ANY(${ids}) LIMIT 8`;
  const byId = new Map(ps.map((p) => [p.id, p]));
  const out: Paper[] = [];
  for (const id of ids) {
    const p = byId.get(id);
    if (p) out.push({ id: p.id, doi: p.doi, title: p.title, year: p.year, venue: p.venue, abstract: p.abstract ?? "" });
  }
  return out.length === ids.length ? out : null;
}

// O(k), two statements in one transaction
// INV: papers and the cache row are written atomically; only bibliographic fields are stored; a repeated id keeps its last copy (as sequential upserts did), so one INSERT never touches a row twice
export async function storePapers(qhash: Buffer, papers: Paper[]): Promise<void> {
  const rows = [...new Map(papers.map((p) => [p.id, p])).values()];
  await sql.begin(async (tx) => {
    if (rows.length > 0) await tx`
      INSERT INTO papers (id, doi, title, year, venue, abstract)
      SELECT p.id, p.doi, p.title, p.year, p.venue, p.abstract
      FROM unnest(${rows.map((p) => p.id)}::text[], ${rows.map((p) => p.doi)}::text[], ${rows.map((p) => p.title)}::text[], ${rows.map((p) => p.year)}::int[], ${rows.map((p) => p.venue)}::text[], ${rows.map((p) => p.abstract)}::text[])
        AS p(id, doi, title, year, venue, abstract)
      ON CONFLICT (id) DO UPDATE SET doi = EXCLUDED.doi, title = EXCLUDED.title, year = EXCLUDED.year, venue = EXCLUDED.venue, abstract = EXCLUDED.abstract, fetched_at = now()`;
    await tx`
      INSERT INTO retrieval_cache (qhash, paper_ids) VALUES (${qhash}, ${papers.map((p) => p.id)})
      ON CONFLICT (qhash) DO UPDATE SET paper_ids = EXCLUDED.paper_ids, fetched_at = now()`;
  });
}
