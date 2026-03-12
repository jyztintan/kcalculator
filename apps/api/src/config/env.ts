import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const currentDir = dirname(fileURLToPath(import.meta.url));
const workspaceEnvPath = resolve(currentDir, "../../../../.env");

config({ path: workspaceEnvPath });
config();

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(4000),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_ALLOWED_USER_IDS: z.string().default(""),
  TELEGRAM_WEBHOOK_URL: z.string().optional(),
  TELEGRAM_USE_WEBHOOK: z
    .string()
    .default("false")
    .transform((value) => value === "true"),
  DASHBOARD_PUBLIC_URL: z.string().optional(),
  DASHBOARD_TOKEN_SECRET: z.string().optional(),
  DEFAULT_CALORIE_TARGET: z.coerce.number().default(2267),
  DEFAULT_TIMEZONE: z.string().default("Asia/Singapore"),
  DEFAULT_DASHBOARD_TELEGRAM_ID: z.string().default(""),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini")
});

export const env = envSchema.parse(process.env);

export const allowedTelegramIds = new Set(
  env.TELEGRAM_ALLOWED_USER_IDS.split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);
