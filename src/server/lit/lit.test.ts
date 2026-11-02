import { expect, test } from "bun:test";
import { abstractFromInverted, filterCitations } from "./core.ts";

test("abstractFromInverted places words by index", () => {
  expect(abstractFromInverted({ b: [1], a: [0], c: [2, 4], d: [3] })).toBe("a b c d c");
});

test("filterCitations strips out-of-range citations", () => {
  const r = filterCitations("x [0] y [2] z [7] [2] [5]", 5);
  expect(r.text).not.toContain("[0]");
  expect(r.text).not.toContain("[7]");
  expect(r.used).toEqual([2, 5]);
});

test("storePapers with 3 papers, one already present, upserts all 3 and findCached returns them in stored order", async () => {
  const { bootTestServer } = await import("../testkit.ts");
  const t = await bootTestServer();
  const { findCached, storePapers } = await import("./sql.ts");
  await t.sql`INSERT INTO papers (id, doi, title, year, venue, abstract) VALUES ('W2', null, 'old', 1999, 'old venue', 'old abstract')`;
  const papers = [
    { id: "W3", doi: "10.1/c", title: "C", year: 2021, venue: "V3", abstract: "c" },
    { id: "W2", doi: "10.1/b", title: "B", year: null, venue: null, abstract: "b" },
    { id: "W1", doi: null, title: "A", year: 2019, venue: "V1", abstract: "" },
  ];
  const qhash = Buffer.from("q".repeat(32));
  await storePapers(qhash, papers);
  expect(await findCached(qhash)).toEqual(papers);
  const [n] = await t.sql`SELECT count(*)::int AS n FROM papers`;
  expect(n.n).toBe(3);
});
