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

export type TopicUse = { lessons: number; questions: number; attempts: number };

// O(n + e)
// INV: counts are what remains after the lesson and its questions are gone
// INV: the lesson topic is released when nothing else uses it; a neighbor is released only when it is unused and does not still support a topic we keep
export function topicsReleasedByLesson(lessonTopicId: string, neighborIds: readonly string[], useOf: ReadonlyMap<string, TopicUse>, edges: readonly { src: string; dst: string }[]): string[] {
  const pool = new Set<string>([lessonTopicId, ...neighborIds]);
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const fromSrc = adj.get(e.src);
    if (fromSrc) fromSrc.push(e.dst);
    else adj.set(e.src, [e.dst]);
    const fromDst = adj.get(e.dst);
    if (fromDst) fromDst.push(e.src);
    else adj.set(e.dst, [e.src]);
  }
  const used = (id: string): boolean => {
    const u = useOf.get(id);
    return u !== undefined && (u.lessons > 0 || u.questions > 0 || u.attempts > 0);
  };
  const drop = new Set<string>();
  if (!used(lessonTopicId)) drop.add(lessonTopicId);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of pool) {
      if (drop.has(id) || used(id)) continue;
      const sticks = (adj.get(id) ?? []).some((other) => !drop.has(other) && (used(other) || !pool.has(other)));
      if (!sticks) {
        drop.add(id);
        changed = true;
      }
    }
  }
  return [...drop];
}
