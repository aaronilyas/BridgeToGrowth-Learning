import { SQL } from "bun";
import { env } from "./env.ts";

export const sql = new SQL({ url: env.DATABASE_URL, max: 10 });
