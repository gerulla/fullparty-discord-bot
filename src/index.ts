process.stdout.write("[FullParty Bot] Boot file loaded.\n");

console.log("[FullParty Bot] Loading config module.");
const { parseConfig } = await import("./config/env.js");

console.log("[FullParty Bot] Loading logger module.");
const { createLogger } = await import("./lib/logger.js");

console.log("[FullParty Bot] Loading FullParty API module.");
const { FullpartyApiClient } = await import("./fullparty/client.js");

console.log("[FullParty Bot] Loading guild settings module.");
const { SqliteGuildSettingsStore } = await import("./guildSettings/store.js");

console.log("[FullParty Bot] Loading payload store module.");
const { LatestPayloadStore } = await import("./payloads/latestPayloadStore.js");

console.log("[FullParty Bot] Loading Discord client module.");
const { createBotClient } = await import("./bot/createClient.js");

console.log("[FullParty Bot] Loading webhook server module.");
const { startWebhookServer, stopWebhookServer } = await import("./http/server.js");

const config = parseConfig();
const logger = createLogger(config.LOG_LEVEL);

console.log(
  `[FullParty Bot] Starting with HTTP ${config.HTTP_HOST}:${String(config.HTTP_PORT)} and log level ${config.LOG_LEVEL}.`,
);

const fullpartyOptions = config.FULLPARTY_API_TOKEN
  ? {
      apiToken: config.FULLPARTY_API_TOKEN,
      baseUrl: config.FULLPARTY_API_BASE_URL,
    }
  : {
      baseUrl: config.FULLPARTY_API_BASE_URL,
    };

const botContext = {
  fullparty: new FullpartyApiClient(fullpartyOptions),
  fullpartyWebBaseUrl: config.FULLPARTY_WEB_BASE_URL,
  guildSettings: new SqliteGuildSettingsStore(config.DATABASE_PATH),
  logger,
  payloads: new LatestPayloadStore(),
};

const client = createBotClient(botContext);

console.log("[FullParty Bot] Starting webhook server.");
const webhookServer = await startWebhookServer({
  client,
  context: botContext,
  fullpartyWebBaseUrl: config.FULLPARTY_WEB_BASE_URL,
  host: config.HTTP_HOST,
  port: config.HTTP_PORT,
  webhookSigningSecret: config.FULLPARTY_WEBHOOK_SIGNING_SECRET,
});

console.log("[FullParty Bot] Starting Discord client login.");
logger.info("Starting Discord client login.");
await client.login(config.DISCORD_TOKEN);

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  logger.info("Received shutdown signal.", { signal });

  await stopWebhookServer(webhookServer);
  await client.destroy();
  process.exit(0);
};

process.once("SIGINT", (signal) => {
  void shutdown(signal);
});
process.once("SIGTERM", (signal) => {
  void shutdown(signal);
});
