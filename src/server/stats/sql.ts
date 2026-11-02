import { sql } from "../db.ts";
import { dateFromMs, jsonText, jsonValue, utcDayOf } from "../sqlmap.ts";
import { MASTERED_AT, type Counters } from "./core.ts";

export type DailyRow = Counters & { day: string };
export type DomainRow = Counters & { domain: string };
export type TopicRow = Counters & { id: string; name: string; domain: string };
export type GraphNodeRow = { id: string; name: string; domain: string; mastery: number; attempts: number; lastSeenAt: string | null };

type Raw = { day: string; attempts: number; correct: number; reviews: number; review_correct: number; conf_err_sum: number };
const DAY_MS = 86_400_000;

// O(days)
// INV: PK range scan on (user_id, day); UTC days like recordAttempt
export async function listDaily(uid: string, days: number): Promise<DailyRow[]> {
  const cutoff = utcDayOf(Date.now() - days * DAY_MS);
  const rows: Raw[] = await sql`
    SELECT day, attempts, correct, reviews, review_correct, conf_err_sum FROM daily_activity
    WHERE user_id = ${uid} AND day > ${cutoff} ORDER BY day LIMIT 366`;
  return rows.map((r) => ({ day: r.day, attempts: r.attempts, correct: r.correct, reviews: r.reviews, reviewCorrect: r.review_correct, confErrSum: r.conf_err_sum }));
}

// O(topics)
// INV: one GROUP BY; only started topics count toward the mastered share
export async function listDomains(uid: string): Promise<DomainRow[]> {
  const rows: { domain: string; attempts: number; correct: number; conf: number; mastered: number; topics: number }[] = await sql`
    SELECT domain, sum(attempts) AS attempts, sum(correct) AS correct, sum(conf_err_sum) AS conf,
      count(*) FILTER (WHERE mastery >= ${MASTERED_AT}) AS mastered, count(*) AS topics
    FROM topics WHERE user_id = ${uid} AND attempts > 0 GROUP BY domain ORDER BY domain LIMIT 50`;
  return rows.map((r) => ({ domain: r.domain, attempts: r.attempts, correct: r.correct, reviews: 0, reviewCorrect: 0, confErrSum: r.conf, mastered: r.mastered, topics: r.topics }));
}

// O(50)
// INV: the order matches topics(user_id, last_seen_at DESC, id), so a user with more topics than the limit gets an ordered index scan; null last_seen_at values are filtered out
export async function listTopStats(uid: string): Promise<TopicRow[]> {
  const rows: { id: string; name: string; domain: string; attempts: number; correct: number; conf_err_sum: number; mastery: number }[] = await sql`
    SELECT id, name, domain, attempts, correct, conf_err_sum, mastery FROM topics
    WHERE user_id = ${uid} AND last_seen_at IS NOT NULL ORDER BY last_seen_at DESC NULLS LAST LIMIT 50`;
  return rows.map((r) => ({ id: r.id, name: r.name, domain: r.domain, attempts: r.attempts, correct: r.correct, reviews: 0, reviewCorrect: 0, confErrSum: r.conf_err_sum, mastered: r.mastery >= MASTERED_AT ? 1 : 0, topics: 1 }));
}

// O(log n) index-only
export async function countDue(uid: string): Promise<number> {
  const rows: { n: number }[] = await sql`SELECT count(*) AS n FROM cards WHERE user_id = ${uid} AND due_at <= ${Date.now()}`;
  return rows[0]?.n ?? 0;
}

// O(500)
// INV: the node order matches topics(user_id, last_seen_at DESC, id), so a user with more topics than the limit gets an ordered index scan
export async function listGraph(uid: string): Promise<{ nodes: GraphNodeRow[]; edges: { src: string; dst: string; kind: "prereq" | "related" }[] }> {
  const raw: { id: string; name: string; domain: string; mastery: number; attempts: number; last_seen_at: number | null }[] = await sql`
    SELECT id, name, domain, mastery, attempts, last_seen_at
    FROM topics WHERE user_id = ${uid} ORDER BY last_seen_at DESC NULLS LAST, id LIMIT 500`;
  const nodes: GraphNodeRow[] = raw.map((n) => ({ id: n.id, name: n.name, domain: n.domain, mastery: n.mastery, attempts: n.attempts, lastSeenAt: n.last_seen_at === null ? null : dateFromMs(n.last_seen_at).toISOString() }));
  if (nodes.length === 0) return { nodes, edges: [] };
  const ids = nodes.map((n) => n.id);
  const edges: { src: string; dst: string; kind: "prereq" | "related" }[] = await sql`
    SELECT src, dst, kind FROM topic_edges WHERE user_id = ${uid} AND src IN ${sql(ids)} AND dst IN ${sql(ids)} LIMIT 5000`;
  return { nodes, edges };
}

// O(log n)
export async function findInsight(uid: string, day: string): Promise<unknown> {
  const rows: { body: unknown }[] = await sql`SELECT body FROM insights WHERE user_id = ${uid} AND day = ${day} LIMIT 1`;
  const body = rows[0]?.body;
  return body === undefined ? null : jsonValue(body);
}

// O(1)
// INV: insight bodies are stored as JSON text
export async function insertInsight(uid: string, day: string, body: unknown): Promise<void> {
  await sql`INSERT INTO insights (user_id, day, body) VALUES (${uid}, ${day}, ${jsonText(body)}) ON CONFLICT (user_id, day) DO NOTHING`;
}
