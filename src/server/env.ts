import { z } from "zod";

export const REASONING_LEVELS = ["low", "high", "max"] as const;
export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

// INV: plan limits have no defaults; an empty value is rejected rather than read as 0
const requireNumber = <T extends z.ZodNumber>(n: T) => z.string().trim().min(1).pipe(z.coerce.number<string>().pipe(n));

const TURNSTILE_TEST_KEY = /^[123]x0{20}/;

const Schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.url(),
  DATABASE_URL: z.string().min(1),
  TEST_DATABASE_URL: z.string().min(1).optional(),
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_BASE_URL: z.url().default("https://openrouter.ai/api/v1"),
  OPENROUTER_MODEL: z.string().min(1).default("openrouter/free"),
  OPENROUTER_REASONING_LEVEL: z.enum(REASONING_LEVELS).default("high"),
  OPENALEX_MAILTO: z.email(),
  STRIPE_SECRET_KEY: z.string().regex(/^(sk|rk)_(test|live)_/),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_"),
  STRIPE_PRICE_ID: z.string().startsWith("price_"),
  TURNSTILE_SITE_KEY: z.string().min(1),
  TURNSTILE_SECRET: z.string().min(1),
  FREE_CAP_USD: requireNumber(z.number().min(0).max(1000)),
  PRO_CAP_USD: requireNumber(z.number().min(0).max(1000)),
  PRO_PRICE_USD: requireNumber(z.number().positive().max(10000)),
  FREE_LESSON_TTL_DAYS: requireNumber(z.number().int().min(1).max(365)),
  RESEND_API_KEY: z.string().trim().min(1).optional(),
  MAIL_FROM: z.string().trim().min(3).max(200).optional(),
  ADSENSE_CLIENT: z.string().trim().regex(/^ca-pub-\d{10,20}$/).optional(),
  ADSENSE_SLOT: z.string().trim().regex(/^\d{5,20}$/).optional(),
}).superRefine((e, ctx) => {
  if (Boolean(e.RESEND_API_KEY) !== Boolean(e.MAIL_FROM)) {
    ctx.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "set with MAIL_FROM" });
    ctx.addIssue({ code: "custom", path: ["MAIL_FROM"], message: "set with RESEND_API_KEY" });
  }
  if (Boolean(e.ADSENSE_CLIENT) !== Boolean(e.ADSENSE_SLOT)) {
    ctx.addIssue({ code: "custom", path: ["ADSENSE_CLIENT"], message: "set with ADSENSE_SLOT" });
    ctx.addIssue({ code: "custom", path: ["ADSENSE_SLOT"], message: "set with ADSENSE_CLIENT" });
  }
  // SEC: production is https-only so the __Host- cookie is set, and Cloudflare's always-pass Turnstile test keys must not ship
  if (e.NODE_ENV !== "production") return;
  if (!e.APP_ORIGIN.startsWith("https://")) ctx.addIssue({ code: "custom", path: ["APP_ORIGIN"], message: "https required" });
  if (TURNSTILE_TEST_KEY.test(e.TURNSTILE_SITE_KEY)) ctx.addIssue({ code: "custom", path: ["TURNSTILE_SITE_KEY"], message: "test key" });
  if (TURNSTILE_TEST_KEY.test(e.TURNSTILE_SECRET)) ctx.addIssue({ code: "custom", path: ["TURNSTILE_SECRET"], message: "test key" });
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
