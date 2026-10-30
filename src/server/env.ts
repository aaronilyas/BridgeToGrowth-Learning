import { z } from "zod";

const Schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.url(),
  DATABASE_URL: z.string().min(1),
  TEST_DATABASE_URL: z.string().min(1).optional(),
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_BASE_URL: z.url().default("https://openrouter.ai/api/v1"),
  STRIPE_SECRET_KEY: z.string().startsWith("sk_"),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_"),
  STRIPE_PRICE_ID: z.string().startsWith("price_"),
  TURNSTILE_SITE_KEY: z.string().min(1),
  TURNSTILE_SECRET: z.string().min(1),
  OPENALEX_MAILTO: z.email(),
  TRIAL_DAYS: z.coerce.number().int().positive().default(7),
  TRIAL_CAP_USD: z.coerce.number().positive().default(1),
  PRO_CAP_USD: z.coerce.number().positive().default(15),
});

export type Env = z.infer<typeof Schema>;

// O(1)
// SEC: logs only the offending key names, never values
function parseEnv(raw: Record<string, string | undefined>): Env {
  const r = Schema.safeParse(raw);
  if (r.success) return r.data;
  const keys = [...new Set(r.error.issues.map((i) => String(i.path[0] ?? "?")))];
  console.error(`invalid env: ${keys.join(", ")}`);
  process.exit(1);
}

export const env: Env = parseEnv(process.env);
