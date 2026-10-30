import { z } from "zod";

export const Season = z.enum(["spring", "summer", "fall", "winter"]);
export type Season = z.infer<typeof Season>;
export type Hemisphere = "N" | "S";

export const SeasonResponse = z.strictObject({ season: Season, hemisphere: z.enum(["N", "S"]), source: z.enum(["lat", "country", "default"]) });
export type SeasonResponse = z.infer<typeof SeasonResponse>;

const SOUTH = new Set(["AR", "AU", "BO", "BR", "BW", "CL", "LS", "MG", "MZ", "NA", "NZ", "PY", "SZ", "UY", "ZA", "ZW"]);
const NORTH_BY_MONTH: readonly Season[] = ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "fall", "fall", "fall", "winter"];

// O(1)
// INV: an empty or non-numeric lat falls through to the country, never to sign(NaN)
export function hemisphereOf(lat: string | null, country: string | null): { h: Hemisphere; source: "lat" | "country" | "default" } {
  const n = lat === null || lat.trim() === "" ? NaN : Number(lat);
  if (Number.isFinite(n)) return { h: n < 0 ? "S" : "N", source: "lat" };
  if (country !== null && /^[A-Za-z]{2}$/.test(country)) return { h: SOUTH.has(country.toUpperCase()) ? "S" : "N", source: "country" };
  return { h: "N", source: "default" };
}

// O(1)
export function seasonOf(month0: number, h: Hemisphere): Season {
  const m = (((Math.trunc(month0) + (h === "S" ? 6 : 0)) % 12) + 12) % 12;
  return NORTH_BY_MONTH[m] ?? "winter";
}
