import { sql } from "../db.ts";
import { jsonText, stringList } from "../sqlmap.ts";
import type { Paper } from "./core.ts";

type PaperRow = { id: string; doi: string | null; title: string; year: number | null; venue: string | null; abstract: string | null };

const WEEK_MS = 7 * 86_400_000;

// O(k)
// INV: a hit is fresher than 7 days; papers come back in the stored order
export async function findCached(qhash: Buffer): Promise<Paper[] | null> {
  const rows: { paper_ids: unknown }[] = await sql`
    SELECT paper_ids FROM retrieval_cache WHERE qhash = ${qhash} AND fetched_at > ${Date.now() - WEEK_MS} LIMIT 1`;
  const ids = rows[0] ? stringList(rows[0].paper_ids) : [];
  if (ids.length === 0) return null;
  const ps: PaperRow[] = await sql`SELECT id, doi, title, year, venue, abstract FROM papers WHERE id IN ${sql(ids)} LIMIT 8`;
  const byId = new Map(ps.map((p) => [p.id, p]));
  const out: Paper[] = [];
  for (const id of ids) {
    const p = byId.get(id);
    if (p) out.push({ id: p.id, doi: p.doi, title: p.title, year: p.year, venue: p.venue, abstract: p.abstract ?? "" });
  }
  return out.length === ids.length ? out : null;
}

// O(k), two statements in one transaction
// INV: papers and the cache row are written atomically; only bibliographic fields are stored; a repeated id keeps its last copy, so one INSERT never touches a row twice
// INV: WHERE true stops SQLite from parsing ON CONFLICT as a join
export async function storePapers(qhash: Buffer, papers: Paper[]): Promise<void> {
  const rows = [...new Map(papers.map((p) => [p.id, p])).values()];
  const at = Date.now();
  await sql.begin(async (tx) => {
    if (rows.length > 0) await tx`
      INSERT INTO papers (id, doi, title, year, venue, abstract, fetched_at)
      SELECT json_extract(j.value, '$.id'), json_extract(j.value, '$.doi'), json_extract(j.value, '$.title'), json_extract(j.value, '$.year'), json_extract(j.value, '$.venue'), json_extract(j.value, '$.abstract'), ${at}
      FROM json_each(${jsonText(rows)}) AS j
      WHERE true
      ON CONFLICT (id) DO UPDATE SET doi = excluded.doi, title = excluded.title, year = excluded.year, venue = excluded.venue, abstract = excluded.abstract, fetched_at = ${at}`;
    await tx`
      INSERT INTO retrieval_cache (qhash, paper_ids, fetched_at) VALUES (${qhash}, ${jsonText(papers.map((p) => p.id))}, ${at})
      ON CONFLICT (qhash) DO UPDATE SET paper_ids = excluded.paper_ids, fetched_at = ${at}`;
  });
}
