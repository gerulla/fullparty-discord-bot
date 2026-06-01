import { describe, expect, it } from "vitest";

import { parseConfig, type Environment } from "../src/config/env.js";

const baseEnv = {
  DISCORD_CLIENT_ID: "discord-client-id",
  DISCORD_TOKEN: "discord-token",
  FULLPARTY_API_BASE_URL: "https://api.fullparty.gg",
  FULLPARTY_WEBHOOK_SIGNING_SECRET: "webhook-signing-secret",
} satisfies Environment;

describe("parseConfig", () => {
  it("parses the minimal required environment", () => {
    const config = parseConfig(baseEnv);

    expect(config).toMatchObject({
      BOT_FAILURE_LOG_PATH: "data/fullparty-discord-bot-failures.jsonl",
      DATABASE_PATH: "data/fullparty-discord-bot.sqlite",
      DISCORD_CLIENT_ID: "discord-client-id",
      DISCORD_COMMAND_REGISTER_SCOPE: "global",
      DISCORD_TOKEN: "discord-token",
      FULLPARTY_API_BASE_URL: "https://api.fullparty.gg",
      FULLPARTY_WEB_BASE_URL: "https://fullparty.gg",
      FULLPARTY_WEBHOOK_SIGNING_SECRET: "webhook-signing-secret",
      GUILD_AUTOMATION_QUEUE_CONCURRENCY: 2,
      GUILD_AUTOMATION_QUEUE_POLL_INTERVAL_MS: 1000,
      GUILD_MEMBER_CACHE_CONCURRENCY: 1,
      GUILD_MEMBER_CACHE_PURGE_AFTER_MS: 604800000,
      GUILD_MEMBER_CACHE_REFRESH_INTERVAL_MS: 86400000,
      GUILD_MEMBER_CACHE_RETRY_AFTER_MS: 900000,
      GUILD_MEMBER_CACHE_SWEEP_INTERVAL_MS: 300000,
      HTTP_HOST: "0.0.0.0",
      HTTP_PORT: 3000,
      LOG_LEVEL: "info",
      NODE_ENV: "development",
      RUNTIME_LOG_DIRECTORY: "data/runtime-logs",
      RUNTIME_LOG_RETENTION_DAYS: 30,
      USER_DM_RATE_LIMIT_COUNT: 2,
      USER_DM_RATE_LIMIT_WINDOW_MS: 300000,
    });
  });

  it("normalizes optional empty strings to undefined", () => {
    const config = parseConfig({
      ...baseEnv,
      ADMIN_API_TOKEN: "",
      DISCORD_GUILD_ID: "",
      FULLPARTY_API_TOKEN: "   ",
      PAYLOAD_COMMAND_ALLOWED_USER_ID: "",
    });

    expect(config.ADMIN_API_TOKEN).toBeUndefined();
    expect(config.DISCORD_GUILD_ID).toBeUndefined();
    expect(config.FULLPARTY_API_TOKEN).toBeUndefined();
    expect(config.PAYLOAD_COMMAND_ALLOWED_USER_ID).toBeUndefined();
  });

  it("parses the payload command allowed user id", () => {
    const config = parseConfig({
      ...baseEnv,
      PAYLOAD_COMMAND_ALLOWED_USER_ID: " 123456789012345678 ",
    });

    expect(config.PAYLOAD_COMMAND_ALLOWED_USER_ID).toBe("123456789012345678");
  });

  it("parses guild automation queue tuning", () => {
    const config = parseConfig({
      ...baseEnv,
      GUILD_AUTOMATION_QUEUE_CONCURRENCY: "4",
      GUILD_AUTOMATION_QUEUE_POLL_INTERVAL_MS: "2000",
      GUILD_MEMBER_CACHE_CONCURRENCY: "2",
      GUILD_MEMBER_CACHE_PURGE_AFTER_MS: "120000",
      GUILD_MEMBER_CACHE_REFRESH_INTERVAL_MS: "60000",
      GUILD_MEMBER_CACHE_RETRY_AFTER_MS: "60000",
      GUILD_MEMBER_CACHE_SWEEP_INTERVAL_MS: "10000",
    });

    expect(config.GUILD_AUTOMATION_QUEUE_CONCURRENCY).toBe(4);
    expect(config.GUILD_AUTOMATION_QUEUE_POLL_INTERVAL_MS).toBe(2000);
    expect(config.GUILD_MEMBER_CACHE_CONCURRENCY).toBe(2);
    expect(config.GUILD_MEMBER_CACHE_PURGE_AFTER_MS).toBe(120000);
    expect(config.GUILD_MEMBER_CACHE_REFRESH_INTERVAL_MS).toBe(60000);
    expect(config.GUILD_MEMBER_CACHE_RETRY_AFTER_MS).toBe(60000);
    expect(config.GUILD_MEMBER_CACHE_SWEEP_INTERVAL_MS).toBe(10000);
  });

  it("parses user DM rate limit tuning", () => {
    const config = parseConfig({
      ...baseEnv,
      USER_DM_RATE_LIMIT_COUNT: "3",
      USER_DM_RATE_LIMIT_WINDOW_MS: "120000",
    });

    expect(config.USER_DM_RATE_LIMIT_COUNT).toBe(3);
    expect(config.USER_DM_RATE_LIMIT_WINDOW_MS).toBe(120000);
  });

  it("reports invalid configuration with field names", () => {
    expect(() =>
      parseConfig({
        DISCORD_CLIENT_ID: "",
        DISCORD_TOKEN: "",
        FULLPARTY_API_BASE_URL: "not-a-url",
      }),
    ).toThrow(/DISCORD_CLIENT_ID|DISCORD_TOKEN|FULLPARTY_API_BASE_URL/u);
  });
});
