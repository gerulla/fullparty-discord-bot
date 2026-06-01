import "dotenv/config";

import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);
const optionalNonEmptyString = z.preprocess(
  (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
  z.string().trim().min(1).optional(),
);
const urlString = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : value),
  z.url(),
);

export const appConfigSchema = z.object({
  BOT_FAILURE_LOG_PATH: nonEmptyString.default(
    "data/fullparty-discord-bot-failures.jsonl",
  ),
  DATABASE_PATH: nonEmptyString.default("data/fullparty-discord-bot.sqlite"),
  DISCORD_CLIENT_ID: nonEmptyString,
  DISCORD_COMMAND_REGISTER_SCOPE: z.enum(["global", "guild"]).default("global"),
  DISCORD_GUILD_ID: optionalNonEmptyString,
  DISCORD_TOKEN: nonEmptyString,
  FULLPARTY_API_BASE_URL: urlString,
  FULLPARTY_API_TOKEN: optionalNonEmptyString,
  FULLPARTY_WEB_BASE_URL: urlString.default("https://fullparty.gg"),
  FULLPARTY_WEBHOOK_SIGNING_SECRET: nonEmptyString,
  GUILD_AUTOMATION_QUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  GUILD_AUTOMATION_QUEUE_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(250)
    .max(60_000)
    .default(1000),
  GUILD_MEMBER_CACHE_CONCURRENCY: z.coerce.number().int().min(1).max(5).default(1),
  GUILD_MEMBER_CACHE_PURGE_AFTER_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .default(604_800_000),
  GUILD_MEMBER_CACHE_REFRESH_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .default(86_400_000),
  GUILD_MEMBER_CACHE_RETRY_AFTER_MS: z.coerce.number().int().min(60_000).default(900_000),
  GUILD_MEMBER_CACHE_SWEEP_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(10_000)
    .default(300_000),
  HTTP_HOST: nonEmptyString.default("0.0.0.0"),
  HTTP_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PAYLOAD_COMMAND_ALLOWED_USER_ID: optionalNonEmptyString,
  USER_DM_RATE_LIMIT_COUNT: z.coerce.number().int().min(1).max(10).default(2),
  USER_DM_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(3_600_000)
    .default(300_000),
});

export type AppConfig = z.infer<typeof appConfigSchema>;
export type Environment = Record<string, string | undefined>;

export function parseConfig(env: Environment = process.env): AppConfig {
  const result = appConfigSchema.safeParse(env);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");

    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return result.data;
}
