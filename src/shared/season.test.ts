import { expect, test } from "bun:test";
import { hemisphereOf, seasonOf, type Season } from "./season.ts";

test("seasonOf covers 12 months in both hemispheres; hemisphereOf prefers lat, then country", () => {
  const north: Season[] = ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "fall", "fall", "fall", "winter"];
  const south: Season[] = ["summer", "summer", "fall", "fall", "fall", "winter", "winter", "winter", "spring", "spring", "spring", "summer"];
  north.forEach((s, m) => expect(seasonOf(m, "N")).toBe(s));
  south.forEach((s, m) => expect(seasonOf(m, "S")).toBe(s));
  expect(hemisphereOf("-33.9", null)).toEqual({ h: "S", source: "lat" });
  expect(hemisphereOf(null, "NZ")).toEqual({ h: "S", source: "country" });
  expect(hemisphereOf(null, null)).toEqual({ h: "N", source: "default" });
  expect(hemisphereOf("abc", "US")).toEqual({ h: "N", source: "country" });
});
