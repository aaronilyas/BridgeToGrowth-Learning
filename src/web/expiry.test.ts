import { expect, test } from "bun:test";
import { formatExpiry } from "./expiry.ts";

const at = Date.parse("2026-04-01T00:00:00.000Z");

test("formatExpiry counts days and hours left before a lesson is deleted", () => {
  expect(formatExpiry(new Date(at + 6 * 86_400_000 + 4 * 3_600_000).toISOString(), at)).toBe("6 days 4 hours left");
  expect(formatExpiry(new Date(at + 86_400_000).toISOString(), at)).toBe("1 day left");
  expect(formatExpiry(new Date(at + 86_400_000 + 3_600_000).toISOString(), at)).toBe("1 day 1 hour left");
});

test("formatExpiry counts hours and minutes inside the last day", () => {
  expect(formatExpiry(new Date(at + 5 * 3_600_000 + 12 * 60_000).toISOString(), at)).toBe("5 hours 12 minutes left");
  expect(formatExpiry(new Date(at + 3_600_000).toISOString(), at)).toBe("1 hour left");
  expect(formatExpiry(new Date(at + 60_000).toISOString(), at)).toBe("1 minute left");
  expect(formatExpiry(new Date(at + 30_000).toISOString(), at)).toBe("Less than a minute left");
});

test("formatExpiry reports a lesson that is already due", () => {
  expect(formatExpiry(new Date(at).toISOString(), at)).toBe("Due for deletion");
  expect(formatExpiry(new Date(at - 1_000).toISOString(), at)).toBe("Due for deletion");
  expect(formatExpiry("not-a-date", at)).toBe("Deletion time unavailable");
});
