import { expect, test } from "bun:test";
import { computeMetrics, streakOf } from "./core.ts";

test("metrics ignore topic names and domains; streaks", () => {
  const counters = { attempts: 10, correct: 7, reviews: 4, reviewCorrect: 3, confErrSum: 2.5, mastered: 1, topics: 2 };
  const a = { name: "Quantum Tunneling", domain: "physics", ...counters };
  const b = { name: "Krebs Cycle", domain: "biology", ...counters };
  expect(computeMetrics(a)).toEqual(computeMetrics(b));
  expect(computeMetrics({ attempts: 0, correct: 0, reviews: 0, reviewCorrect: 0, confErrSum: 0 }).accuracy).toBeNull();
  const run = (ds: string[]): { day: string; attempts: number }[] => ds.map((day) => ({ day, attempts: 1 }));
  expect(streakOf(run(["2026-03-08", "2026-03-09", "2026-03-10"]), "2026-03-10")).toBe(3);
  expect(streakOf(run(["2026-03-08"]), "2026-03-10")).toBe(0);
});
