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
      DATABASE_PATH: "data/fullparty-discord-bot.sqlite",
      DISCORD_CLIENT_ID: "discord-client-id",
      DISCORD_COMMAND_REGISTER_SCOPE: "global",
      DISCORD_TOKEN: "discord-token",
      FULLPARTY_API_BASE_URL: "https://api.fullparty.gg",
      FULLPARTY_WEB_BASE_URL: "https://fullparty.gg",
      FULLPARTY_WEBHOOK_SIGNING_SECRET: "webhook-signing-secret",
      HTTP_HOST: "0.0.0.0",
      HTTP_PORT: 3000,
      LOG_LEVEL: "info",
      NODE_ENV: "development",
    });
  });

  it("normalizes optional empty strings to undefined", () => {
    const config = parseConfig({
      ...baseEnv,
      DISCORD_GUILD_ID: "",
      FULLPARTY_API_TOKEN: "   ",
    });

    expect(config.DISCORD_GUILD_ID).toBeUndefined();
    expect(config.FULLPARTY_API_TOKEN).toBeUndefined();
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
