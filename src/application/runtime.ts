import { SqliteAdminStore, createAdminApiToken } from "@fullparty/admin";
import type { BotContext } from "../bot/context.js";
import { createBotClient } from "../bot/createClient.js";
import type { parseConfig } from "../config/env.js";
import { openSqliteDatabase } from "../database/sqlite.js";
import { deliverStoredDm } from "../dm/deliveryService.js";
import { SqliteDmQueueStore } from "../dm/queueStore.js";
import { UserDmRateLimiter } from "../dm/userDmRateLimiter.js";
import { FullpartyApiClient } from "../fullparty/client.js";
import { GuildAutomationService } from "../guildAutomation/automationService.js";
import { SqliteGuildRunReminderQueue } from "../guildAutomation/runReminderQueue.js";
import { SqliteGuildRunRoleStore } from "../guildAutomation/runRoleStore.js";
import { GuildMemberCacheScheduler } from "../guildMembership/memberCacheScheduler.js";
import { SqliteGuildMemberCacheStore } from "../guildMembership/memberCacheStore.js";
import { SqliteGuildSettingsStore } from "../guildSettings/store.js";
import { SqliteFailureReporter } from "../health/failureReporter.js";
import { startWebhookServer, stopWebhookServer } from "../http/server.js";
import type { Logger } from "../lib/logger.js";
import type { RuntimeLogBuffer } from "../lib/runtimeLogBuffer.js";
import { LatestPayloadStore } from "../payloads/latestPayloadStore.js";
import { ApplicationResources } from "./resources.js";

export async function startApplication(
  config: ReturnType<typeof parseConfig>,
  logger: Logger,
  runtimeLogs: RuntimeLogBuffer,
): Promise<{ context: BotContext; stop(): Promise<void> }> {
  const resources = new ApplicationResources(logger);
  try {
    const adminToken = createAdminApiToken(config.ADMIN_API_TOKEN);
    logger.info("Admin API token is ready.", {
      source: adminToken.source,
      rotatesOnRestart: adminToken.source === "generated",
    });
    const failureReporter = new SqliteFailureReporter({
      databasePath: config.DATABASE_PATH,
      logFilePath: config.BOT_FAILURE_LOG_PATH,
    });
    resources.add("failure reporter", () => {
      failureReporter.close();
    });
    const guildSettings = new SqliteGuildSettingsStore(config.DATABASE_PATH);
    resources.add("guild settings", () => {
      guildSettings.close();
    });
    const guildMemberCache = new SqliteGuildMemberCacheStore(config.DATABASE_PATH);
    resources.add("member cache", () => {
      guildMemberCache.close();
    });
    const adminDatabase = openSqliteDatabase(config.DATABASE_PATH);
    resources.add("admin database", () => {
      adminDatabase.close();
    });
    const adminStore = new SqliteAdminStore(adminDatabase);
    const guildRunRoles = new SqliteGuildRunRoleStore(config.DATABASE_PATH);
    resources.add("run roles", () => {
      guildRunRoles.close();
    });
    const dmStore = new SqliteDmQueueStore(config.DATABASE_PATH);
    resources.add("DM database", () => {
      dmStore.close();
    });
    const userDmRateLimiter = new UserDmRateLimiter({
      store: dmStore,
      startPaused: true,
      failureReporter,
      limit: config.USER_DM_RATE_LIMIT_COUNT,
      logger,
      windowMs: config.USER_DM_RATE_LIMIT_WINDOW_MS,
    });
    const context: BotContext = {
      adminApiToken: adminToken.value,
      adminStore,
      failureReporter,
      guildSettings,
      guildMemberCache,
      guildRunRoles,
      userDmRateLimiter,
      fullparty: new FullpartyApiClient({
        baseUrl: config.FULLPARTY_API_BASE_URL,
        ...(config.FULLPARTY_API_TOKEN ? { apiToken: config.FULLPARTY_API_TOKEN } : {}),
      }),
      fullpartyWebBaseUrl: config.FULLPARTY_WEB_BASE_URL,
      logger,
      payloadCommandAllowedUserId: config.PAYLOAD_COMMAND_ALLOWED_USER_ID,
      payloads: new LatestPayloadStore(),
      runtimeLogs,
    };
    const client = createBotClient(context);
    resources.add("Discord client", () => client.destroy());
    resources.add("DM queue", async () => {
      userDmRateLimiter.stop();
      await userDmRateLimiter.waitForIdle();
    });
    userDmRateLimiter.restore((job) => deliverStoredDm({ client, context }, job));
    const memberScheduler = new GuildMemberCacheScheduler({
      client,
      concurrency: config.GUILD_MEMBER_CACHE_CONCURRENCY,
      failureReporter,
      logger,
      purgeAfterMs: config.GUILD_MEMBER_CACHE_PURGE_AFTER_MS,
      refreshIntervalMs: config.GUILD_MEMBER_CACHE_REFRESH_INTERVAL_MS,
      retryAfterMs: config.GUILD_MEMBER_CACHE_RETRY_AFTER_MS,
      settingsStore: guildSettings,
      store: guildMemberCache,
      sweepIntervalMs: config.GUILD_MEMBER_CACHE_SWEEP_INTERVAL_MS,
    });
    resources.add("member scheduler", () => memberScheduler.stop());
    const automation = new GuildAutomationService({ client, context });
    const automationQueue = new SqliteGuildRunReminderQueue({
      concurrency: config.GUILD_AUTOMATION_QUEUE_CONCURRENCY,
      databasePath: config.DATABASE_PATH,
      failureReporter,
      logger,
      pollIntervalMs: config.GUILD_AUTOMATION_QUEUE_POLL_INTERVAL_MS,
      processor: (job) =>
        job.kind === "run_reminder"
          ? automation.remind(job.data)
          : automation.complete(job.data),
    });
    resources.add("automation queue", () => automationQueue.stop());
    context.guildMemberCacheScheduler = memberScheduler;
    context.guildRunReminderQueue = automationQueue;
    logger.info("Starting webhook server.", {
      host: config.HTTP_HOST,
      port: config.HTTP_PORT,
    });
    const server = await startWebhookServer({
      client,
      context,
      fullpartyWebBaseUrl: config.FULLPARTY_WEB_BASE_URL,
      host: config.HTTP_HOST,
      adminApiToken: adminToken.value,
      port: config.HTTP_PORT,
      webhookSigningSecret: config.FULLPARTY_WEBHOOK_SIGNING_SECRET,
    });
    resources.add("HTTP server", () => stopWebhookServer(server));
    logger.info("Starting Discord client login.");
    await client.login(config.DISCORD_TOKEN);
    userDmRateLimiter.resume();
    memberScheduler.start();
    automationQueue.start();
    return { context, stop: () => resources.close() };
  } catch (error) {
    try {
      await resources.close();
    } catch (cleanupError) {
      logger.error("Startup cleanup failed.", { error: cleanupError });
    }
    throw error;
  }
}
