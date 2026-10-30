import { z } from "zod";
import { env } from "../env.ts";
import { abstractFromInverted, normalizeQuery, type Paper } from "./core.ts";
import { findCached, storePapers } from "./sql.ts";

const Work = z.object({
  id: z.string(),
  doi: z.string().nullish(),
  title: z.string().nullish(),
  publication_year: z.number().nullish(),
  primary_location: z.object({ source: z.object({ display_name: z.string().nullish() }).nullish() }).nullish(),
  abstract_inverted_index: z.record(z.string(), z.array(z.number())).nullish(),
});
const Resp = z.object({ results: z.array(Work) });

// O(k) per request
// SEC: only the normalized, URL-encoded query leaves the server
async function fetchWorks(q: string, k: number): Promise<Paper[]> {
  const filter = "type:article,has_abstract:true,is_retracted:false,primary_location.source.type:journal";
  const select = "id,doi,title,publication_year,primary_location,abstract_inverted_index";
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(q)}&filter=${filter}&per_page=${k}&select=${select}&mailto=${encodeURIComponent(env.OPENALEX_MAILTO)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return [];
  const parsed = Resp.safeParse(await res.json());
  if (!parsed.success) return [];
  const out: Paper[] = [];
  for (const w of parsed.data.results) {
    const abstract = abstractFromInverted(w.abstract_inverted_index ?? {});
    if (!w.title || !abstract) continue;
    out.push({ id: w.id, doi: w.doi ?? null, title: w.title, year: w.publication_year ?? null, venue: w.primary_location?.source?.display_name ?? null, abstract });
  }
  return out.slice(0, k);
}

// O(1) amortized on cache hit (PK lookup + ANY(ids)); 1 HTTP call on miss
// INV: never throws; failure yields []
export async function retrievePapers(query: string, k: number): Promise<Paper[]> {
  try {
    const kk = Math.max(1, Math.min(8, Math.floor(k)));
    const q = normalizeQuery(query);
    if (!q) return [];
    const qhash = Buffer.from(new Bun.CryptoHasher("sha256").update(`${q}|${kk}`).digest());
    const hit = await findCached(qhash);
    if (hit) {
      console.log(`lit cache hit k=${kk}`);
      return hit;
    }
    const papers = await fetchWorks(q, kk);
    if (papers.length > 0) await storePapers(qhash, papers);
    return papers;
  } catch {
    return [];
  }
}
