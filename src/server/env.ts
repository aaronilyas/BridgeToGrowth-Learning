import { z } from "zod";

const Schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  OPENROUTER_BASE_URL: z.url().default("https://openrouter.ai/api/v1"),
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
