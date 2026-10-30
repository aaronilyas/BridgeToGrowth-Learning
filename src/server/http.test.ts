import { expect, test } from "bun:test";
import { z } from "zod";

process.env.NODE_ENV = "test";
process.env.APP_ORIGIN = "https://app.test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://x";
process.env.OPENROUTER_API_KEY = "k";
process.env.STRIPE_SECRET_KEY = "sk_test_x";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
process.env.STRIPE_PRICE_ID = "price_x";
process.env.TURNSTILE_SITE_KEY = "s";
process.env.TURNSTILE_SECRET = "s";
process.env.OPENALEX_MAILTO = "a@example.com";

test("route rejects foreign origin and unknown body keys", async () => {
  const { route, json } = await import("./http.ts");
  const h = route({ body: z.strictObject({ a: z.string() }) }, async (c) => json({ a: c.body.a }));
  const post = (origin: string, body: unknown) =>
    h(new Request("http://127.0.0.1/x", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }));
  const evil = await post("https://evil.test", { a: "1" });
  expect(evil.status).toBe(403);
  expect(await evil.json()).toEqual({ error: "forbidden_origin" });
  expect((await post("https://app.test", { a: "1", b: 2 })).status).toBe(400);
});
