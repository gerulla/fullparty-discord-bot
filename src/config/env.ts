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
  DATABASE_PATH: nonEmptyString.default("data/fullparty-discord-bot.sqlite"),
  DISCORD_CLIENT_ID: nonEmptyString,
  DISCORD_COMMAND_REGISTER_SCOPE: z.enum(["global", "guild"]).default("global"),
  DISCORD_GUILD_ID: optionalNonEmptyString,
  DISCORD_TOKEN: nonEmptyString,
  FULLPARTY_API_BASE_URL: urlString,
  FULLPARTY_API_TOKEN: optionalNonEmptyString,
  FULLPARTY_WEB_BASE_URL: urlString.default("https://fullparty.gg"),
  FULLPARTY_WEBHOOK_SIGNING_SECRET: nonEmptyString,
  HTTP_HOST: nonEmptyString.default("0.0.0.0"),
  HTTP_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
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
