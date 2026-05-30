import type { BotContext } from "./bot/context.js";

process.stdout.write("[FullParty Bot] Boot file loaded.\n");

console.log("[FullParty Bot] Loading config module.");
const { parseConfig } = await import("./config/env.js");

console.log("[FullParty Bot] Loading logger module.");
const { createLogger } = await import("./lib/logger.js");

console.log("[FullParty Bot] Loading FullParty API module.");
const { FullpartyApiClient } = await import("./fullparty/client.js");

console.log("[FullParty Bot] Loading guild settings module.");
const { SqliteGuildSettingsStore } = await import("./guildSettings/store.js");

console.log("[FullParty Bot] Loading guild automation queue module.");
const { SqliteGuildRunReminderQueue } =
  await import("./guildAutomation/runReminderQueue.js");

console.log("[FullParty Bot] Loading guild run-role store module.");
const { SqliteGuildRunRoleStore } = await import("./guildAutomation/runRoleStore.js");

console.log("[FullParty Bot] Loading guild member cache module.");
const { GuildMemberCacheScheduler } =
  await import("./guildMembership/memberCacheScheduler.js");
const { SqliteGuildMemberCacheStore } =
  await import("./guildMembership/memberCacheStore.js");

console.log("[FullParty Bot] Loading failure reporter module.");
const { SqliteFailureReporter } = await import("./health/failureReporter.js");

console.log("[FullParty Bot] Loading payload store module.");
const { LatestPayloadStore } = await import("./payloads/latestPayloadStore.js");

console.log("[FullParty Bot] Loading Discord client module.");
const { createBotClient } = await import("./bot/createClient.js");

console.log("[FullParty Bot] Loading webhook server module.");
const {
  processGuildRunCompleted,
  processGuildRunReminder,
  startWebhookServer,
  stopWebhookServer,
} = await import("./http/server.js");

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
const guildMemberCache = new SqliteGuildMemberCacheStore(config.DATABASE_PATH);

const botContext: BotContext = {
  failureReporter: new SqliteFailureReporter({
    databasePath: config.DATABASE_PATH,
    logFilePath: config.BOT_FAILURE_LOG_PATH,
  }),
  fullparty: new FullpartyApiClient(fullpartyOptions),
  fullpartyWebBaseUrl: config.FULLPARTY_WEB_BASE_URL,
  guildMemberCache,
  guildRunRoles: new SqliteGuildRunRoleStore(config.DATABASE_PATH),
  guildSettings: new SqliteGuildSettingsStore(config.DATABASE_PATH),
  logger,
  payloadCommandAllowedUserId: config.PAYLOAD_COMMAND_ALLOWED_USER_ID,
  payloads: new LatestPayloadStore(),
};

const client = createBotClient(botContext);
const guildMemberCacheScheduler = new GuildMemberCacheScheduler({
  client,
  concurrency: config.GUILD_MEMBER_CACHE_CONCURRENCY,
  failureReporter: botContext.failureReporter,
  logger,
  purgeAfterMs: config.GUILD_MEMBER_CACHE_PURGE_AFTER_MS,
  refreshIntervalMs: config.GUILD_MEMBER_CACHE_REFRESH_INTERVAL_MS,
  retryAfterMs: config.GUILD_MEMBER_CACHE_RETRY_AFTER_MS,
  store: guildMemberCache,
  sweepIntervalMs: config.GUILD_MEMBER_CACHE_SWEEP_INTERVAL_MS,
});
const guildRunReminderQueue = new SqliteGuildRunReminderQueue({
  concurrency: config.GUILD_AUTOMATION_QUEUE_CONCURRENCY,
  databasePath: config.DATABASE_PATH,
  failureReporter: botContext.failureReporter,
  logger,
  pollIntervalMs: config.GUILD_AUTOMATION_QUEUE_POLL_INTERVAL_MS,
  processor: (job) =>
    job.kind === "run_reminder"
      ? processGuildRunReminder({ client, context: botContext }, job.data)
      : processGuildRunCompleted({ client, context: botContext }, job.data),
});

botContext.guildMemberCacheScheduler = guildMemberCacheScheduler;
botContext.guildRunReminderQueue = guildRunReminderQueue;

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
guildMemberCacheScheduler.start();
guildRunReminderQueue.start();

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  logger.info("Received shutdown signal.", { signal });

  await stopWebhookServer(webhookServer);
  await guildMemberCacheScheduler.stop();
  await guildRunReminderQueue.stop();
  botContext.failureReporter?.close?.();
  botContext.guildMemberCache?.close?.();
  botContext.guildRunRoles?.close?.();
  await client.destroy();
  process.exit(0);
};

process.once("SIGINT", (signal) => {
  void shutdown(signal);
});
process.once("SIGTERM", (signal) => {
  void shutdown(signal);
});
