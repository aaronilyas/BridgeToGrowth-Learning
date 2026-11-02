import { z } from "zod";

const REASONING_LEVELS = ["low", "high", "max"] as const;
export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

const Schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_BASE_URL: z.url().default("https://openrouter.ai/api/v1"),
  OPENROUTER_MODEL: z.string().min(1).default("openrouter/free"),
  OPENROUTER_REASONING_LEVEL: z.enum(REASONING_LEVELS).default("high"),
});

export type Env = z.infer<typeof Schema>;

// O(1)
// SEC: logs only offending key names, never values
function parseEnv(raw: Record<string, string | undefined>): Env {
  const parsed = Schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const keys = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "?")))];
  console.error(`invalid env: ${keys.join(", ")}`);
  process.exit(1);
}

export const env: Env = parseEnv(process.env);
