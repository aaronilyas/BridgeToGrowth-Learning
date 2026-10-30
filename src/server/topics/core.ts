import type { Domain, EdgeKind } from "../../shared/api.ts";

export type TopicIn = { name: string; domain: Domain };
export type EdgeIn = { src: number; dst: number; kind: EdgeKind };
export type TopicRow = { slug: string; name: string; domain: Domain };
export type EdgeRow = { src: string; dst: string; kind: EdgeKind };

// O(n)
export function slugOf(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/['’‘`]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.slice(0, 64).replace(/-+$/, "");
}

// O(n)
// INV: rows are unique by slug (first name wins); rowOf[i] is the row index of input i, or -1 when the slug is empty
export function dedupeTopics(topics: TopicIn[]): { rows: TopicRow[]; rowOf: number[] } {
  const seen = new Map<string, number>();
  const rows: TopicRow[] = [];
  const rowOf = topics.map((t) => {
    const slug = slugOf(t.name);
    if (slug === "") return -1;
    let at = seen.get(slug);
    if (at === undefined) {
      at = rows.length;
      seen.set(slug, at);
      rows.push({ slug, name: t.name.trim().slice(0, 120), domain: t.domain });
    }
    return at;
  });
  return { rows, rowOf };
}

// O(e)
// INV: self-edges, duplicates and out-of-range or unusable indices are dropped; ids are in row order
export function resolveEdges(edges: EdgeIn[], rowOf: number[], ids: string[]): EdgeRow[] {
  const out = new Map<string, EdgeRow>();
  for (const e of edges) {
    const a = rowOf[e.src];
    const b = rowOf[e.dst];
    const src = a === undefined || a < 0 ? undefined : ids[a];
    const dst = b === undefined || b < 0 ? undefined : ids[b];
    if (src === undefined || dst === undefined || src === dst) continue;
    out.set(`${src}|${dst}|${e.kind}`, { src, dst, kind: e.kind });
  }
  return [...out.values()];
}
