import { expect, test } from "bun:test";
import { acceptUpload, sniffMime } from "./core.ts";

const b = (...x: number[]): Uint8Array => new Uint8Array(x);
const text = (s: string): Uint8Array => new TextEncoder().encode(s);

test("sniffMime and acceptUpload judge by magic bytes", () => {
  expect(sniffMime(text("%PDF-1.7"))).toBe("application/pdf");
  expect(sniffMime(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png");
  expect(() => acceptUpload(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), "application/pdf")).toThrow();
  expect(acceptUpload(text("%PDF-1.4"), "application/pdf")).toBe("application/pdf");
  for (const h of [text("<svg xmlns"), b(0x50, 0x4b, 3, 4), text("<!doctype html>"), b()]) expect(sniffMime(h)).toBeNull();
});
