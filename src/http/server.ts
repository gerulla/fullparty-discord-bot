import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { PermissionFlagsBits, PermissionsBitField } from "discord.js";
import type { APIEmbed, APIEmbedField, Client, MessageCreateOptions } from "discord.js";
import { z } from "zod";

import { handleAdminApiRequest } from "../admin/adminApi.js";
import type {
  AdminAutomationRunInput,
  AdminBotEventInput,
  AdminDmDeliveryInput,
  AdminGuildMessageInput,
  AdminStore,
} from "../admin/adminStore.js";
import { handleAdminUiRequest } from "../admin/adminUi.js";
import type { BotContext } from "../bot/context.js";
import {
  createAutomationFailureDetailsCustomId,
  storeAutomationFailureDetails,
  type AutomationFailureDetailsSection,
} from "../guildAutomation/automationFailureDetails.js";
import {
  createDiscordGuildSnapshot,
  serializeGuildSettings,
} from "../guildAutomation/guildSnapshot.js";
import {
  guildRunCompletedDataSchema,
  guildRunReminderDataSchema,
  type GuildRunCompletedData,
  type GuildRunReminderData,
} from "../guildAutomation/runReminderTypes.js";
import type { GuildMemberCacheSnapshot } from "../guildMembership/memberCacheStore.js";
import type { GuildSettings } from "../guildSettings/types.js";
import type { GuildSettingsPatch } from "../guildSettings/types.js";
import {
  type HealthStatus,
  recordFailureSafely,
  serializeFailureError,
} from "../health/failureReporter.js";
import { formatDiscordDateTime } from "../lib/discordTimestamps.js";
import { NotificationMessageService } from "../notifications/notificationMessageService.js";
import { notificationDeliveryDataSchema } from "../notifications/types.js";

const fullpartyEventSchema = z.looseObject({
  data: z.unknown().optional(),
  event: z.string().trim().min(1),
  id: z.string().trim().min(1).optional(),
  requestId: z.string().trim().min(1).optional(),
  request_id: z.string().trim().min(1).optional(),
});

const userAppEventDataSchema = z.looseObject({
  discord_user: z.looseObject({
    id: z.string().trim().min(1),
  }),
  welcome_message: z.string().trim().min(1).max(2000).optional(),
});

const guildSnapshotRequestedDataSchema = z.looseObject({
  discord_guild_id: z.string().trim().min(1),
});

const guildMembershipSnapshotRequestedDataSchema = z.looseObject({
  discord_guild_id: z.string().trim().min(1),
  include_member_ids: z.boolean().optional(),
  request_refresh_if_stale: z.boolean().optional(),
});

const guildDisconnectedDataSchema = z.looseObject({
  disconnected_at: z.string().trim().min(1).optional(),
  discord_guild_id: z.string().trim().min(1),
  group_id: z.number().int().positive().optional(),
  group_name: z.string().trim().min(1).optional(),
  group_slug: z.string().trim().min(1).optional(),
});

const nullableSettingIdSchema = z.string().trim().min(1).nullable().optional();

const runRoleTemplateOverrideSchema = z.object({
  activity_id: z.number().int().positive(),
  activity_name: z.string().trim().min(1).max(300),
  created_at: z.string().trim().min(1).nullable().optional(),
  role_id: z.string().trim().min(1),
  updated_at: z.string().trim().min(1).nullable().optional(),
});

const guildSettingsUpdatedDataSchema = z.looseObject({
  discord_guild_id: z.string().trim().min(1),
  settings: z.looseObject({
    bot_log_channel_id: nullableSettingIdSchema,
    bot_moderator_role_id: nullableSettingIdSchema,
    run_announcement_channel_id: nullableSettingIdSchema,
    run_role_template_overrides: z.array(runRoleTemplateOverrideSchema).optional(),
    run_role_template_id: nullableSettingIdSchema,
    sync_discord_names_to_ff14: z.boolean().optional(),
    upcoming_raider_role_id: nullableSettingIdSchema,
  }),
});

const userAppDisconnectedMessage = [
  "FullParty has disconnected Discord for your account.",
  "To fully remove the app from Discord, open Discord Settings > Authorized Apps and remove FullParty.",
].join("\n");

const userAppInstalledMessage = [
  "Hey, welcome to FullParty. Your Discord account is connected and ready to go.",
  "You can use `/runs` to check your upcoming runs and `/applications` to review your FullParty applications right here in DMs.",
  "I'll also send your FullParty notifications in this DM, so run updates, applications, reminders, and account changes stay easy to find.",
  "You can disconnect this anytime from your FullParty account settings.",
].join("\n\n");

const integrationHealthcheckEvent = "integration.healthcheck";
const discordNicknameLimit = 32;

export type WebhookServerOptions = {
  adminApiToken?: string | undefined;
  adminUiRoot?: string | undefined;
  client: Client;
  context: BotContext;
  fullpartyWebBaseUrl: string;
  host: string;
  maxBodyBytes?: number;
  port: number;
  signatureToleranceSeconds?: number;
  webhookSigningSecret: string;
};

type FullpartyEvent = z.infer<typeof fullpartyEventSchema>;

type ActionResult = Record<string, unknown>;
type GuildAutomationProcessorOptions = Pick<WebhookServerOptions, "client" | "context">;
type RoleAssignmentProcessorOptions = {
  dryRun?: boolean | undefined;
};
type DmDeliveryMetadata = {
  eventType?: string | undefined;
  notificationType?: string | undefined;
};
type HealthCheckResult = {
  ok: boolean;
  status: HealthStatus | "not_configured";
  [key: string]: unknown;
};

type SendableUser = {
  send(message: MessageCreateOptions): Promise<{ id: string }>;
};

type GuildRunReminderGuild = {
  channels?: {
    fetch(): Promise<unknown>;
  };
  members: {
    fetch(discordUserId: string): Promise<GuildRunReminderMember>;
    me?: GuildRunReminderMember | null;
  };
  roles?: {
    cache?: {
      get(roleId: string): unknown;
    };
    create?(options: GuildRoleCreateOptions): Promise<GuildRunRole>;
    fetch?(roleId: string): Promise<unknown>;
  };
};

type GuildRunReminderMember = {
  displayName?: string;
  nickname?: string | null;
  permissions?: {
    has(permission: bigint): boolean;
  };
  roles?: {
    add?(roleId: string, reason?: string): Promise<unknown>;
    highest?: GuildRunRole;
  };
  setNickname?(nickname: string, reason?: string): Promise<unknown>;
};

type GuildRunRole = {
  color?: number;
  comparePositionTo?(role: GuildRunRole): number;
  delete?(reason?: string): Promise<unknown>;
  hoist?: boolean;
  id: string;
  mentionable?: boolean;
  name: string;
  permissions?: {
    bitfield?: bigint | number | string;
    toString?(): string;
  };
  position?: number;
};

type GuildRoleCreateOptions = {
  color?: number;
  hoist?: boolean;
  mentionable?: boolean;
  name: string;
  permissions?: string;
  reason?: string;
};

type GuildPermissionOverwrite = {
  allow?: PermissionOverwriteValue;
  deny?: PermissionOverwriteValue;
  id: string;
  type?: number | string;
};

type GuildPermissionOverwriteChannel = {
  id: string;
  name?: string;
  permissionOverwrites?: {
    cache?: {
      get(id: string): unknown;
    };
    edit?(
      roleId: string,
      options: Record<string, boolean>,
      reason?: string,
    ): Promise<unknown>;
  };
};

type PermissionOverwriteValue = {
  bitfield?: bigint | number | string;
  toString?(): string;
};

type SendableChannel = {
  send(message: MessageCreateOptions): Promise<unknown>;
};

type GuildMessageTelemetryMetadata = {
  discordGuildId?: string | undefined;
  messageType?: string | undefined;
};

export async function startWebhookServer(
  options: WebhookServerOptions,
): Promise<ReturnType<typeof createWebhookServer>> {
  const server = createWebhookServer(options);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const resolvedAddress = typeof address === "string" ? address : formatAddress(address);

  options.context.logger.info("Fullparty integration endpoint is listening.", {
    address: resolvedAddress,
    path: "/events",
  });

  return server;
}

export function createWebhookServer(options: WebhookServerOptions) {
  return createServer((request, response) => {
    void handleRequest(request, response, options);
  });
}

export async function stopWebhookServer(
  server: ReturnType<typeof createWebhookServer>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: WebhookServerOptions,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  let eventLogWritten = false;
  let eventName: string | undefined;

  try {
    if (
      await handleAdminApiRequest(request, response, url, {
        adminApiToken: options.adminApiToken,
        client: options.client,
        context: options.context,
        createHealth: () => createHealthResponse(options),
      })
    ) {
      return;
    }

    if (
      await handleAdminUiRequest(request, response, url, {
        adminUiRoot: options.adminUiRoot,
      })
    ) {
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, await createHealthResponse(options));
      return;
    }

    if (request.method === "GET" && url.pathname === "/events") {
      handleHealthcheckRequest(request, response, options);
      writeEventConsoleLog(request, url, integrationHealthcheckEvent);
      recordAdminBotEvent(options.context.adminStore, options.context.logger, {
        eventType: integrationHealthcheckEvent,
        occurredAt: new Date().toISOString(),
        requestHost: getRequestHost(request),
        status: "accepted",
      });
      eventLogWritten = true;
      return;
    }

    if (request.method !== "POST" || url.pathname !== "/events") {
      sendJson(response, 404, {
        error: "not_found",
        message: "Route not found.",
      });
      return;
    }

    const rawBody = await readRawBody(request, options.maxBodyBytes ?? 1024 * 1024);
    assertJsonContentType(request);
    verifyWebhookSignature(
      request,
      rawBody,
      options.webhookSigningSecret,
      options.signatureToleranceSeconds ?? 300,
    );
    const receivedPayload = parseJsonBody(rawBody);
    options.context.payloads.set(receivedPayload, "FullParty event payload");
    const event = parseEvent(receivedPayload);
    eventName = event.event;
    writeEventConsoleLog(request, url, event.event, getEventDataType(event));
    eventLogWritten = true;
    const result = await dispatchEvent(event, options);
    recordAdminBotEvent(options.context.adminStore, options.context.logger, {
      ...getAdminEventSubject(event),
      dataType: getEventDataType(event),
      eventType: event.event,
      occurredAt: new Date().toISOString(),
      requestHost: getRequestHost(request),
      requestId: getRequestId(event),
      status: "accepted",
    });

    sendJson(response, 200, {
      event: event.event,
      ok: true,
      requestId: getRequestId(event),
      result,
    });
  } catch (error) {
    if (url.pathname === "/events" && !eventLogWritten) {
      writeRejectedEventConsoleLog(request, url, error);
    }

    if (url.pathname === "/events") {
      recordWebhookFailure(options, request, url, error, eventName);
      recordAdminBotEvent(options.context.adminStore, options.context.logger, {
        eventType: eventName ?? "unknown",
        occurredAt: new Date().toISOString(),
        requestHost: getRequestHost(request),
        status: "failed",
        errorCode: getEventErrorCode(error),
      });
    }

    handleError(response, error, options);
  }
}

function writeEventConsoleLog(
  request: IncomingMessage,
  url: URL,
  event: string,
  dataType?: string,
): void {
  const dataTypeSegment = dataType ? `; data type: ${dataType}` : "";

  process.stdout.write(
    `[FullParty Bot] Event received from ${getRequestHost(request)}: ${event}${dataTypeSegment} (${request.method ?? "UNKNOWN"} ${url.pathname}).\n`,
  );
}

function writeRejectedEventConsoleLog(
  request: IncomingMessage,
  url: URL,
  error: unknown,
): void {
  process.stdout.write(
    `[FullParty Bot] Event rejected from ${getRequestHost(request)}: ${getEventErrorCode(error)} (${request.method ?? "UNKNOWN"} ${url.pathname}).\n`,
  );
}

async function createHealthResponse(options: WebhookServerOptions): Promise<{
  checks: Record<string, HealthCheckResult>;
  ok: boolean;
  status: HealthStatus;
  timestamp: string;
  uptime_seconds: number;
}> {
  const checks: Record<string, HealthCheckResult> = {
    discord: createDiscordHealthCheck(options.client),
  };

  checks.recent_failures = options.context.failureReporter
    ? await options.context.failureReporter.getHealthSummary()
    : {
        configured: false,
        ok: true,
        status: "not_configured",
      };

  checks.guild_automation_queue = options.context.guildRunReminderQueue?.getHealthSummary
    ? await options.context.guildRunReminderQueue.getHealthSummary()
    : {
        configured: false,
        ok: true,
        status: "not_configured",
      };

  checks.guild_member_cache = options.context.guildMemberCacheScheduler
    ? await options.context.guildMemberCacheScheduler.getHealthSummary()
    : {
        configured: false,
        ok: true,
        status: "not_configured",
      };

  const status = aggregateHealthStatus(Object.values(checks));

  return {
    checks,
    ok: status !== "unhealthy",
    status,
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
  };
}

function createDiscordHealthCheck(client: Client): HealthCheckResult {
  const ready = typeof client.isReady === "function" ? client.isReady() : false;
  const pingMs = "ws" in client ? client.ws.ping : undefined;
  const userId = client.user?.id;

  return {
    ok: ready,
    ping_ms: typeof pingMs === "number" ? pingMs : null,
    ready,
    status: ready ? "healthy" : "unhealthy",
    user_id: userId ?? null,
  };
}

function aggregateHealthStatus(checks: HealthCheckResult[]): HealthStatus {
  if (checks.some((check) => check.status === "unhealthy")) {
    return "unhealthy";
  }

  if (checks.some((check) => check.status === "degraded")) {
    return "degraded";
  }

  return "healthy";
}

function recordWebhookFailure(
  options: WebhookServerOptions,
  request: IncomingMessage,
  url: URL,
  error: unknown,
  eventName: string | undefined,
): void {
  recordFailureSafely(options.context.failureReporter, options.context.logger, {
    action: "event_processing",
    details: {
      error: serializeFailureError(error),
      method: request.method ?? "UNKNOWN",
      path: url.pathname,
      requestHost: getRequestHost(request),
    },
    errorCode: getEventErrorCode(error),
    eventType: eventName,
    message: getErrorMessage(error),
    severity: getFailureSeverity(error),
    source: "webhook",
  });
}

function recordAdminBotEvent(
  store: AdminStore | undefined,
  logger: BotContext["logger"],
  input: AdminBotEventInput,
): void {
  void store?.recordBotEvent(input).catch((error: unknown) => {
    logger.warn("Unable to record admin bot event telemetry.", { error });
  });
}

function recordAdminDmDelivery(
  store: AdminStore | undefined,
  logger: BotContext["logger"],
  input: AdminDmDeliveryInput,
): void {
  void store?.recordDmDelivery(input).catch((error: unknown) => {
    logger.warn("Unable to record admin DM telemetry.", { error });
  });
}

function recordAdminAutomationRun(
  store: AdminStore | undefined,
  logger: BotContext["logger"],
  input: AdminAutomationRunInput,
): void {
  void store?.recordAutomationRun(input).catch((error: unknown) => {
    logger.warn("Unable to record admin automation telemetry.", { error });
  });
}

function recordAdminGuildMessage(
  store: AdminStore | undefined,
  logger: BotContext["logger"],
  input: AdminGuildMessageInput,
): void {
  void store?.recordGuildMessage(input).catch((error: unknown) => {
    logger.warn("Unable to record admin guild message telemetry.", { error });
  });
}

function getAdminEventSubject(
  event: FullpartyEvent,
): Pick<AdminBotEventInput, "discordGuildId" | "discordUserId"> {
  if (!isRecord(event.data)) {
    return {};
  }

  const discordGuildId = getStringProperty(event.data, "discord_guild_id");
  const discordUser = event.data.discord_user;
  const discordUserId = isRecord(discordUser)
    ? getStringProperty(discordUser, "id")
    : undefined;

  return {
    ...(discordGuildId ? { discordGuildId } : {}),
    ...(discordUserId ? { discordUserId } : {}),
  };
}

async function dispatchEvent(
  event: FullpartyEvent,
  options: WebhookServerOptions,
): Promise<ActionResult> {
  if (event.event === "discord.user_app.installed") {
    const data = userAppEventDataSchema.parse(event.data);
    const discordUserId = data.discord_user.id;

    return sendUserDm(
      options,
      discordUserId,
      {
        content: data.welcome_message ?? userAppInstalledMessage,
      },
      {
        eventType: event.event,
        notificationType: event.event,
      },
    );
  }

  if (event.event === "discord.user_app.disconnected") {
    const data = userAppEventDataSchema.parse(event.data);
    const discordUserId = data.discord_user.id;

    return sendUserDm(
      options,
      discordUserId,
      {
        content: userAppDisconnectedMessage,
      },
      {
        eventType: event.event,
        notificationType: event.event,
      },
    );
  }

  if (event.event === "discord.notification.delivery") {
    const data = notificationDeliveryDataSchema.parse(event.data);
    const discordUserId = data.discord_user.id;
    const notificationMessageService = new NotificationMessageService({
      fullpartyWebBaseUrl: options.fullpartyWebBaseUrl,
    });
    const result = await sendUserDm(
      options,
      discordUserId,
      notificationMessageService.createDmMessage(data),
      {
        eventType: event.event,
        notificationType: data.type,
      },
    );

    return {
      ...result,
      category: data.category,
      notificationDeliveryId: data.notification_delivery_id,
      notificationEventId: data.notification_event_id,
      type: data.type,
    };
  }

  if (event.event === "discord.guild.run_reminder") {
    const data = guildRunReminderDataSchema.parse(event.data);

    await markGuildLinked(options, data.discord_guild_id);
    await sendGuildRunAutomationStartedMessage(options, data);

    return options.context.guildRunReminderQueue
      ? options.context.guildRunReminderQueue.enqueue({ data, kind: "run_reminder" })
      : processGuildRunReminder(options, data);
  }

  if (
    event.event === "discord.guild.run_completed" ||
    event.event === "discord.guild.run_cancelled"
  ) {
    const data = parseGuildRunCleanupData(event);

    await markGuildLinked(options, data.discord_guild_id);

    return options.context.guildRunReminderQueue
      ? options.context.guildRunReminderQueue.enqueue({ data, kind: "run_completed" })
      : processGuildRunCompleted(options, data);
  }

  if (event.event === "discord.guild.snapshot_requested") {
    const data = guildSnapshotRequestedDataSchema.parse(event.data);

    return createGuildSnapshotResult(options, data.discord_guild_id);
  }

  if (event.event === "discord.guild.membership_snapshot_requested") {
    const data = guildMembershipSnapshotRequestedDataSchema.parse(event.data);

    return createGuildMembershipSnapshotResult(options, data);
  }

  if (event.event === "discord.guild.disconnected") {
    const data = guildDisconnectedDataSchema.parse(event.data);

    return disconnectGuildFromFullparty(options, data);
  }

  if (event.event === "discord.guild.settings_updated") {
    const data = guildSettingsUpdatedDataSchema.parse(event.data);

    return updateGuildSettingsFromFullparty(options, data);
  }

  throw new HttpError(
    400,
    "unsupported_event",
    `Unsupported Fullparty event type: ${event.event}`,
  );
}

function parseGuildRunCleanupData(event: FullpartyEvent): GuildRunCompletedData {
  if (event.event === "discord.guild.run_cancelled") {
    return guildRunCompletedDataSchema.parse({
      ...(isRecord(event.data) ? event.data : {}),
      type: "runs.cancelled",
    });
  }

  return guildRunCompletedDataSchema.parse(event.data);
}

export async function processGuildRunReminder(
  options: GuildAutomationProcessorOptions,
  data: GuildRunReminderData,
): Promise<ActionResult> {
  const settings = await options.context.guildSettings.get(data.discord_guild_id);
  const result = {
    ...(await assignUpcomingRaiderRole(options, data, settings)),
    ...(await syncRunReminderNicknames(options, data, settings)),
  };

  recordRunReminderAutomationTelemetry(options, data, result);

  return result;
}

async function sendGuildRunAutomationStartedMessage(
  options: GuildAutomationProcessorOptions,
  data: GuildRunReminderData,
): Promise<void> {
  const settings = await options.context.guildSettings.get(data.discord_guild_id);

  await sendBotLogMessage(
    options,
    settings.botLogChannelId,
    buildGuildRunAutomationStartedMessage(data),
    {
      discordGuildId: data.discord_guild_id,
      messageType: "guild_run_automation_started",
    },
  );
}

export async function processGuildRunRoleAssignment(
  options: GuildAutomationProcessorOptions,
  data: GuildRunReminderData,
  processorOptions: RoleAssignmentProcessorOptions = {},
): Promise<ActionResult> {
  const settings = await options.context.guildSettings.get(data.discord_guild_id);
  const result = await assignUpcomingRaiderRole(
    options,
    data,
    settings,
    processorOptions,
  );

  recordRoleAssignmentAutomationTelemetry(options, data, result);

  return result;
}

export async function processGuildRunCompleted(
  options: GuildAutomationProcessorOptions,
  data: GuildRunCompletedData,
): Promise<ActionResult> {
  const settings = await options.context.guildSettings.get(data.discord_guild_id);
  const result = await deleteRunRole(options, data, settings);

  recordCleanupAutomationTelemetry(options, data, result);

  return result;
}

function recordRunReminderAutomationTelemetry(
  options: GuildAutomationProcessorOptions,
  data: GuildRunReminderData,
  result: ActionResult,
): void {
  recordRoleAssignmentAutomationTelemetry(options, data, result);
  recordAdminAutomationRun(options.context.adminStore, options.context.logger, {
    automationType: "nickname_sync",
    discordGuildId: data.discord_guild_id,
    durationMs: getResultNumber(result, "nicknameProcessingTimeMs"),
    eventType: data.type,
    failureCount: getResultNumber(result, "nicknameFailedUserCount") ?? 0,
    result,
    runId: data.run_id,
    skippedCount: getResultNumber(result, "nicknameSkippedUserCount") ?? 0,
    status: getAutomationStatus({
      failureCount: getResultNumber(result, "nicknameFailedUserCount") ?? 0,
      skippedReason: getResultString(result, "nicknameSkippedReason"),
      successCount: getResultNumber(result, "nicknameSyncedUserCount") ?? 0,
    }),
    successCount: getResultNumber(result, "nicknameSyncedUserCount") ?? 0,
  });
}

function recordRoleAssignmentAutomationTelemetry(
  options: GuildAutomationProcessorOptions,
  data: GuildRunReminderData,
  result: ActionResult,
): void {
  const successCount = getResultNumber(result, "assignedUserCount") ?? 0;
  const failureCount = getResultNumber(result, "failedUserCount") ?? 0;

  recordAdminAutomationRun(options.context.adminStore, options.context.logger, {
    automationType: "role_assignment",
    discordGuildId: data.discord_guild_id,
    durationMs: getResultNumber(result, "roleProcessingTimeMs"),
    eventType: data.type,
    failureCount,
    result,
    runId: data.run_id,
    skippedCount: getResultString(result, "skippedReason")
      ? (getResultNumber(result, "requestedUserCount") ?? 0)
      : 0,
    status: getAutomationStatus({
      failureCount,
      skippedReason: getResultString(result, "skippedReason"),
      successCount,
    }),
    successCount,
  });
}

function recordCleanupAutomationTelemetry(
  options: GuildAutomationProcessorOptions,
  data: GuildRunCompletedData,
  result: ActionResult,
): void {
  const successCount = getResultNumber(result, "deletedRoleCount") ?? 0;
  const failureCount = getResultNumber(result, "failedRoleCount") ?? 0;

  recordAdminAutomationRun(options.context.adminStore, options.context.logger, {
    automationType: "role_cleanup",
    discordGuildId: data.discord_guild_id,
    eventType: data.type,
    failureCount,
    result,
    runId: data.run_id,
    skippedCount: getResultString(result, "skippedReason") ? 1 : 0,
    status: getAutomationStatus({
      failureCount,
      skippedReason: getResultString(result, "skippedReason"),
      successCount,
    }),
    successCount,
  });
}

function getAutomationStatus(input: {
  failureCount: number;
  skippedReason: string | undefined;
  successCount: number;
}): AdminAutomationRunInput["status"] {
  if (input.skippedReason) {
    return "skipped";
  }

  if (input.failureCount > 0 && input.successCount === 0) {
    return "failed";
  }

  if (input.failureCount > 0) {
    return "partial";
  }

  return "completed";
}

async function createGuildSnapshotResult(
  options: GuildAutomationProcessorOptions,
  discordGuildId: string,
): Promise<ActionResult> {
  await markGuildLinked(options, discordGuildId);
  const snapshot = await createDiscordGuildSnapshot(
    options.client,
    options.context,
    discordGuildId,
  );
  const membershipCache = options.context.guildMemberCache
    ? serializeGuildMemberCacheSnapshot(
        await options.context.guildMemberCache.getSnapshot(discordGuildId, {
          includeUserIds: false,
        }),
      )
    : {
        configured: false,
      };

  return {
    channelCount: snapshot.channels.length,
    discordGuildId: snapshot.discord_guild_id,
    memberCount: snapshot.member_count,
    membershipCache,
    roleCount: snapshot.roles.length,
    snapshot,
  };
}

async function createGuildMembershipSnapshotResult(
  options: GuildAutomationProcessorOptions,
  data: z.infer<typeof guildMembershipSnapshotRequestedDataSchema>,
): Promise<ActionResult> {
  if (!options.context.guildMemberCache) {
    return {
      configured: false,
      discordGuildId: data.discord_guild_id,
      linked: false,
      membershipCache: null,
      refreshQueued: false,
    };
  }

  const settings = await options.context.guildSettings.get(data.discord_guild_id);

  if (!settings.linkedAt) {
    return {
      configured: true,
      discordGuildId: data.discord_guild_id,
      linked: false,
      membershipCache: null,
      refreshQueued: false,
    };
  }

  const includeUserIds = data.include_member_ids ?? true;
  const requestRefreshIfStale = data.request_refresh_if_stale ?? true;
  const snapshot = await options.context.guildMemberCache.getSnapshot(
    data.discord_guild_id,
    {
      includeUserIds,
    },
  );
  const shouldQueueRefresh =
    requestRefreshIfStale && snapshot.refreshStatus !== "refreshing" && snapshot.stale;
  const refreshResult =
    shouldQueueRefresh && options.context.guildMemberCacheScheduler
      ? await options.context.guildMemberCacheScheduler.enqueueRefresh(
          data.discord_guild_id,
          "dashboard_request",
        )
      : undefined;

  return {
    configured: true,
    discordGuildId: data.discord_guild_id,
    linked: true,
    membershipCache: serializeGuildMemberCacheSnapshot(snapshot),
    refreshQueued: refreshResult?.queued ?? false,
    ...(refreshResult
      ? {
          refreshAlreadyQueued: refreshResult.alreadyQueued,
          refreshReason: refreshResult.reason,
        }
      : {}),
  };
}

async function updateGuildSettingsFromFullparty(
  options: GuildAutomationProcessorOptions,
  data: z.infer<typeof guildSettingsUpdatedDataSchema>,
): Promise<ActionResult> {
  const current = await options.context.guildSettings.get(data.discord_guild_id);
  const patch = createGuildSettingsPatch(data.settings);

  if (!current.linkedAt) {
    patch.linkedAt = new Date().toISOString();
  }

  const settings = await options.context.guildSettings.update(
    data.discord_guild_id,
    patch,
  );

  return {
    discordGuildId: data.discord_guild_id,
    settings: serializeGuildSettings(settings),
    updated: true,
  };
}

async function disconnectGuildFromFullparty(
  options: GuildAutomationProcessorOptions,
  data: z.infer<typeof guildDisconnectedDataSchema>,
): Promise<ActionResult> {
  const archivedAt = new Date();
  const archive = await createGuildDisconnectArchive(options, data, archivedAt);
  const archivePath = await writeGuildDisconnectArchive(data, archive);

  await options.context.guildSettings.update(data.discord_guild_id, {
    linkedAt: null,
    runRoleTemplateOverrides: [],
  });
  await options.context.guildMemberCache?.markGuildObsolete(
    data.discord_guild_id,
    archivedAt,
  );

  options.context.logger.info("FullParty guild disconnected.", {
    archivePath,
    discordGuildId: data.discord_guild_id,
    groupId: data.group_id,
    groupSlug: data.group_slug,
  });

  return {
    archived: true,
    archivePath,
    discordGuildId: data.discord_guild_id,
    groupId: data.group_id ?? null,
    groupSlug: data.group_slug ?? null,
    unlinked: true,
  };
}

async function createGuildDisconnectArchive(
  options: GuildAutomationProcessorOptions,
  data: z.infer<typeof guildDisconnectedDataSchema>,
  archivedAt: Date,
): Promise<Record<string, unknown>> {
  const settings = await options.context.guildSettings.get(data.discord_guild_id);
  const membershipCache = options.context.guildMemberCache
    ? serializeGuildMemberCacheSnapshot(
        await options.context.guildMemberCache.getSnapshot(data.discord_guild_id, {
          includeUserIds: true,
        }),
      )
    : null;
  const runRoleMappings = options.context.guildRunRoles?.listByGuild
    ? await options.context.guildRunRoles.listByGuild(data.discord_guild_id)
    : null;
  const liveSnapshot = await createBestEffortLiveGuildSnapshot(options, data);

  return {
    archived_at: archivedAt.toISOString(),
    disconnected_event: data,
    discord_guild_id: data.discord_guild_id,
    group_id: data.group_id ?? null,
    group_name: data.group_name ?? null,
    group_slug: data.group_slug ?? null,
    local_data: {
      live_guild_snapshot: liveSnapshot,
      membership_cache: membershipCache,
      run_role_mappings: runRoleMappings,
      settings: serializeGuildSettings(settings),
    },
  };
}

async function createBestEffortLiveGuildSnapshot(
  options: GuildAutomationProcessorOptions,
  data: z.infer<typeof guildDisconnectedDataSchema>,
): Promise<unknown> {
  try {
    return await createDiscordGuildSnapshot(
      options.client,
      options.context,
      data.discord_guild_id,
    );
  } catch (error) {
    return {
      error: serializeFailureError(error),
      unavailable: true,
    };
  }
}

async function writeGuildDisconnectArchive(
  data: z.infer<typeof guildDisconnectedDataSchema>,
  archive: Record<string, unknown>,
): Promise<string> {
  const directory = join(
    process.cwd(),
    "history",
    "groups",
    "unlinked",
    createGroupHistoryDirectoryName(data),
  );
  const archivePath = join(directory, "data.json");
  const temporaryArchivePath = join(directory, "data.json.tmp");

  await mkdir(directory, { recursive: true });
  await writeFile(temporaryArchivePath, `${JSON.stringify(archive, null, 2)}\n`, "utf8");
  await rename(temporaryArchivePath, archivePath);

  return archivePath;
}

function createGroupHistoryDirectoryName(
  data: z.infer<typeof guildDisconnectedDataSchema>,
): string {
  return sanitizeHistoryPathSegment(
    data.group_slug ??
      data.group_name ??
      (data.group_id ? `group-${String(data.group_id)}` : undefined) ??
      `discord-guild-${data.discord_guild_id}`,
  );
}

function sanitizeHistoryPathSegment(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 120);

  return sanitized.length > 0 ? sanitized : "unknown-group";
}

async function markGuildLinked(
  options: GuildAutomationProcessorOptions,
  discordGuildId: string,
): Promise<void> {
  const settings = await options.context.guildSettings.get(discordGuildId);

  if (settings.linkedAt) {
    return;
  }

  await options.context.guildSettings.update(discordGuildId, {
    linkedAt: new Date().toISOString(),
  });
}

function createGuildSettingsPatch(
  settings: GuildSettingsUpdatedSettings,
): GuildSettingsPatch {
  const patch: GuildSettingsPatch = {};

  setPatchId(settings, patch, "bot_log_channel_id", "botLogChannelId");
  setPatchId(settings, patch, "bot_moderator_role_id", "botModeratorRoleId");
  setPatchId(settings, patch, "run_announcement_channel_id", "runAnnouncementChannelId");
  setPatchId(settings, patch, "upcoming_raider_role_id", "upcomingRaiderRoleId");

  if (hasOwn(settings, "run_role_template_id")) {
    patch.upcomingRaiderRoleId = settings.run_role_template_id ?? null;
  }

  if (hasOwn(settings, "run_role_template_overrides")) {
    const overrides = settings.run_role_template_overrides ?? [];

    patch.runRoleTemplateOverrides = overrides.map((override) => ({
      activityId: override.activity_id,
      activityName: override.activity_name,
      ...(override.created_at ? { createdAt: override.created_at } : {}),
      roleId: override.role_id,
      ...(override.updated_at ? { updatedAt: override.updated_at } : {}),
    }));
  }

  if (
    typeof settings.sync_discord_names_to_ff14 === "boolean" &&
    hasOwn(settings, "sync_discord_names_to_ff14")
  ) {
    patch.syncDiscordNamesToFf14 = settings.sync_discord_names_to_ff14;
  }

  return patch;
}

type GuildSettingsUpdatedSettings = z.infer<
  typeof guildSettingsUpdatedDataSchema
>["settings"];
type GuildSettingsUpdatedIdKey =
  | "bot_log_channel_id"
  | "bot_moderator_role_id"
  | "run_announcement_channel_id"
  | "upcoming_raider_role_id";
type GuildSettingsPatchIdKey = keyof Omit<
  GuildSettingsPatch,
  "runRoleTemplateOverrides" | "syncDiscordNamesToFf14"
>;

function serializeGuildMemberCacheSnapshot(snapshot: GuildMemberCacheSnapshot): {
  cache_age_seconds: number | null;
  cached_member_count: number;
  discord_member_count: number | null;
  discord_guild_id: string;
  discord_user_ids?: string[];
  last_error: string | null;
  last_full_refresh_at: string | null;
  member_count: number;
  next_refresh_after: string | null;
  refresh_status: GuildMemberCacheSnapshot["refreshStatus"];
  stale: boolean;
  updated_at: string | null;
} {
  return {
    cache_age_seconds: snapshot.cacheAgeSeconds,
    cached_member_count: snapshot.cachedMemberCount,
    discord_member_count: snapshot.memberCount,
    discord_guild_id: snapshot.discordGuildId,
    ...(snapshot.discordUserIds ? { discord_user_ids: snapshot.discordUserIds } : {}),
    last_error: snapshot.lastError,
    last_full_refresh_at: snapshot.lastFullRefreshAt,
    member_count: snapshot.cachedMemberCount,
    next_refresh_after: snapshot.nextRefreshAfter,
    refresh_status: snapshot.refreshStatus,
    stale: snapshot.stale,
    updated_at: snapshot.updatedAt,
  };
}

function setPatchId(
  settings: GuildSettingsUpdatedSettings,
  patch: GuildSettingsPatch,
  sourceKey: GuildSettingsUpdatedIdKey,
  targetKey: GuildSettingsPatchIdKey,
): void {
  if (hasOwn(settings, sourceKey)) {
    const value = settings[sourceKey];

    patch[targetKey] = typeof value === "string" ? value : null;
  }
}

function recordGuildAutomationIssue(
  options: GuildAutomationProcessorOptions,
  input: {
    action: string;
    data: GuildRunCompletedData | GuildRunReminderData;
    details?: unknown;
    errorCode: string | undefined;
    affectsHealth?: boolean | undefined;
    message: string;
    severity: "warn" | "error";
  },
): void {
  recordFailureSafely(options.context.failureReporter, options.context.logger, {
    action: input.action,
    affectsHealth: input.affectsHealth ?? true,
    details: input.details,
    discordGuildId: input.data.discord_guild_id,
    errorCode: input.errorCode,
    eventType: input.data.type,
    message: input.message,
    runId: input.data.run_id,
    severity: input.severity,
    source: "guild_automation",
  });
}

function shouldRunRoleSkippedReasonAffectHealth(
  skippedReason: string | undefined,
): boolean {
  if (!skippedReason) {
    return true;
  }

  return !nonHealthRunRoleSkippedReasons.has(skippedReason);
}

const nonHealthRunRoleSkippedReasons = new Set([
  "bot_missing_manage_roles",
  "template_role_not_below_bot",
  "template_role_not_found",
  "upcoming_raider_role_not_configured",
]);

async function assignUpcomingRaiderRole(
  options: GuildAutomationProcessorOptions,
  data: GuildRunReminderData,
  settings: GuildSettings,
  processorOptions: RoleAssignmentProcessorOptions = {},
): Promise<ActionResult> {
  const discordUserIds = getRunReminderDiscordUserIds(data);
  const dryRun = processorOptions.dryRun === true;
  const templateSelection = selectRunRoleTemplate(settings, data);
  const baseResult = {
    discordGuildId: data.discord_guild_id,
    reminderType: data.reminder_type,
    requestedUserCount: discordUserIds.length,
    ...(dryRun ? { roleDryRun: true } : {}),
    runId: data.run_id,
    ...(templateSelection.overrideActivityId
      ? {
          templateOverrideActivityId: templateSelection.overrideActivityId,
          templateOverrideActivityName: templateSelection.overrideActivityName,
        }
      : {}),
    templateRoleSource: templateSelection.source,
    type: data.type,
  };

  if (!templateSelection.roleId) {
    const result = {
      ...baseResult,
      assignedUserCount: 0,
      failedUserCount: 0,
      roleProcessingTimeMs: 0,
      skippedReason: "upcoming_raider_role_not_configured",
    };

    await sendBotLogMessage(
      options,
      settings.botLogChannelId,
      buildRunReminderRoleSyncLogMessage(data, result),
    );

    return result;
  }

  if (!dryRun && !options.context.guildRunRoles) {
    const result = {
      ...baseResult,
      assignedUserCount: 0,
      failedUserCount: 0,
      roleProcessingTimeMs: 0,
      skippedReason: "run_role_store_not_configured",
      templateRoleId: templateSelection.roleId,
    };

    recordGuildAutomationIssue(options, {
      action: "run_role_assign",
      data,
      errorCode: "run_role_store_not_configured",
      message: "Run role database is not configured.",
      severity: "error",
    });
    await sendBotLogMessage(
      options,
      settings.botLogChannelId,
      buildRunReminderRoleSyncLogMessage(data, result),
    );

    return result;
  }

  if (discordUserIds.length === 0) {
    const result = {
      ...baseResult,
      assignedUserCount: 0,
      failedUserCount: 0,
      roleProcessingTimeMs: 0,
      skippedReason: "no_discord_users",
      templateRoleId: templateSelection.roleId,
    };

    await sendBotLogMessage(
      options,
      settings.botLogChannelId,
      buildRunReminderRoleSyncLogMessage(data, result),
    );

    return result;
  }

  if (dryRun) {
    const result = await inspectUpcomingRaiderRoleAssignment(
      options,
      data,
      settings,
      baseResult,
    );

    await sendBotLogMessage(
      options,
      settings.botLogChannelId,
      buildRunReminderRoleSyncLogMessage(data, result),
    );

    return result;
  }

  const failures: { discordUserId: string; error: string }[] = [];
  const startedAt = Date.now();
  let assignedUserCount = 0;
  let copiedOverwriteCount = 0;
  let createdRunRole = false;
  let runRoleId: string | undefined;
  let runRoleName: string | undefined;
  let templateRoleId: string | undefined = templateSelection.roleId;

  try {
    const guild = await fetchGuildRunReminderGuild(options.client, data.discord_guild_id);
    const ensureRoleResult = await ensureRunRole(options, guild, data, settings);

    if (!ensureRoleResult.role) {
      const result = {
        ...baseResult,
        assignedUserCount: 0,
        failedUserCount: ensureRoleResult.failures.length,
        failures: ensureRoleResult.failures,
        roleProcessingTimeMs: Date.now() - startedAt,
        skippedReason: ensureRoleResult.skippedReason,
        templateRoleId: templateSelection.roleId,
      };

      recordGuildAutomationIssue(options, {
        affectsHealth: shouldRunRoleSkippedReasonAffectHealth(
          ensureRoleResult.skippedReason,
        ),
        action: "run_role_assign",
        data,
        details: result,
        errorCode: ensureRoleResult.skippedReason,
        message: formatRunReminderSkippedReason(
          ensureRoleResult.skippedReason ?? "run_role_assign_failed",
        ),
        severity: "warn",
      });
      await sendBotLogMessage(
        options,
        settings.botLogChannelId,
        buildRunReminderRoleSyncLogMessage(data, result),
      );

      return result;
    }

    copiedOverwriteCount = ensureRoleResult.copiedOverwriteCount;
    createdRunRole = ensureRoleResult.created;
    failures.push(...ensureRoleResult.failures);
    runRoleId = ensureRoleResult.role.id;
    runRoleName = ensureRoleResult.role.name;
    templateRoleId = ensureRoleResult.templateRole.id;

    for (const discordUserId of discordUserIds) {
      try {
        const member = await guild.members.fetch(discordUserId);

        if (!isRoleAssignableMember(member)) {
          throw new Error(`Discord member ${discordUserId} cannot receive roles.`);
        }

        await member.roles.add(
          ensureRoleResult.role.id,
          `FullParty ${data.reminder_type} run role for run ${String(data.run_id)}`,
        );
        assignedUserCount += 1;
      } catch (error) {
        failures.push({
          discordUserId,
          error: getErrorMessage(error),
        });
      }
    }
  } catch (error) {
    failures.push({
      discordUserId: "*",
      error: getErrorMessage(error),
    });
  }

  const result = {
    ...baseResult,
    assignedUserCount,
    copiedOverwriteCount,
    createdRunRole,
    failedUserCount: failures.length,
    failures,
    roleId: runRoleId,
    roleName: runRoleName,
    roleProcessingTimeMs: Date.now() - startedAt,
    templateRoleId,
  };

  if (failures.length > 0) {
    recordGuildAutomationIssue(options, {
      affectsHealth: false,
      action: "run_role_assign",
      data,
      details: result,
      errorCode: "run_role_assign_partial_failure",
      message: `${String(failures.length)} run role assignment issue(s) occurred.`,
      severity: assignedUserCount > 0 ? "warn" : "error",
    });
  }

  await sendBotLogMessage(
    options,
    settings.botLogChannelId,
    buildRunReminderRoleSyncLogMessage(data, result),
  );

  return result;
}

async function inspectUpcomingRaiderRoleAssignment(
  options: GuildAutomationProcessorOptions,
  data: GuildRunReminderData,
  settings: GuildSettings,
  baseResult: ActionResult,
): Promise<ActionResult> {
  const failures: RunReminderFailure[] = [];
  const startedAt = Date.now();
  let assignableUserCount = 0;
  const templateSelection = selectRunRoleTemplate(settings, data);
  let templateRoleId: string | undefined = templateSelection.roleId;

  try {
    const guild = await fetchGuildRunReminderGuild(options.client, data.discord_guild_id);
    const templateRole = templateSelection.roleId
      ? await fetchGuildRole(guild, templateSelection.roleId)
      : undefined;

    if (!templateSelection.roleId || !templateRole) {
      return {
        ...baseResult,
        assignedUserCount: 0,
        copiedOverwriteCount: 0,
        failedUserCount: 0,
        roleProcessingTimeMs: Date.now() - startedAt,
        skippedReason: templateSelection.roleId
          ? "template_role_not_found"
          : "upcoming_raider_role_not_configured",
        templateRoleId: templateSelection.roleId,
      };
    }

    templateRoleId = templateRole.id;

    const preflightFailure = getRunRolePreflightFailure(guild, templateRole);

    if (preflightFailure) {
      return {
        ...baseResult,
        assignedUserCount: 0,
        copiedOverwriteCount: 0,
        failedUserCount: 0,
        roleProcessingTimeMs: Date.now() - startedAt,
        skippedReason: preflightFailure,
        templateRoleId,
      };
    }

    for (const discordUserId of getRunReminderDiscordUserIds(data)) {
      try {
        const member = await guild.members.fetch(discordUserId);

        if (!isRoleAssignableMember(member)) {
          throw new Error(`Discord member ${discordUserId} cannot receive roles.`);
        }

        assignableUserCount += 1;
      } catch (error) {
        failures.push({
          discordUserId,
          error: getErrorMessage(error),
        });
      }
    }
  } catch (error) {
    failures.push({
      discordUserId: "*",
      error: getErrorMessage(error),
    });
  }

  return {
    ...baseResult,
    assignedUserCount: assignableUserCount,
    copiedOverwriteCount: 0,
    createdRunRole: false,
    failedUserCount: failures.length,
    failures,
    roleProcessingTimeMs: Date.now() - startedAt,
    templateRoleId,
  };
}

type EnsureRunRoleResult = {
  copiedOverwriteCount: number;
  created: boolean;
  failures: RunReminderFailure[];
  role?: GuildRunRole;
  roleName: string;
  skippedReason?: string;
  templateRole: GuildRunRole;
};

type RunRoleTemplateSelection = {
  overrideActivityId?: number | undefined;
  overrideActivityName?: string | undefined;
  roleId?: string | undefined;
  source: "default" | "none" | "override";
};

function selectRunRoleTemplate(
  settings: GuildSettings,
  data: GuildRunReminderData,
): RunRoleTemplateSelection {
  const override = data.activity_id
    ? settings.runRoleTemplateOverrides?.find(
        (candidate) => candidate.activityId === data.activity_id,
      )
    : undefined;

  if (override) {
    return {
      overrideActivityId: override.activityId,
      overrideActivityName: override.activityName,
      roleId: override.roleId,
      source: "override",
    };
  }

  if (settings.upcomingRaiderRoleId) {
    return {
      ...(data.activity_id ? { overrideActivityId: data.activity_id } : {}),
      roleId: settings.upcomingRaiderRoleId,
      source: "default",
    };
  }

  return {
    ...(data.activity_id ? { overrideActivityId: data.activity_id } : {}),
    source: "none",
  };
}

async function ensureRunRole(
  options: GuildAutomationProcessorOptions,
  guild: GuildRunReminderGuild,
  data: GuildRunReminderData,
  settings: GuildSettings,
): Promise<EnsureRunRoleResult> {
  const failures: RunReminderFailure[] = [];
  const templateSelection = selectRunRoleTemplate(settings, data);
  const templateRoleId = templateSelection.roleId;

  if (!templateRoleId) {
    return {
      copiedOverwriteCount: 0,
      created: false,
      failures,
      roleName: "",
      skippedReason: "upcoming_raider_role_not_configured",
      templateRole: createUnknownRole(templateRoleId ?? "unknown"),
    };
  }

  const templateRole = await fetchGuildRole(guild, templateRoleId);

  if (!templateRole) {
    return {
      copiedOverwriteCount: 0,
      created: false,
      failures,
      roleName: "",
      skippedReason: "template_role_not_found",
      templateRole: createUnknownRole(templateRoleId),
    };
  }

  const preflightFailure = getRunRolePreflightFailure(guild, templateRole);

  if (preflightFailure) {
    return {
      copiedOverwriteCount: 0,
      created: false,
      failures,
      roleName: "",
      skippedReason: preflightFailure,
      templateRole,
    };
  }

  const existingMapping = await options.context.guildRunRoles?.get(
    data.discord_guild_id,
    data.run_id,
  );

  if (existingMapping?.status === "active") {
    const mappedRole = await fetchGuildRole(guild, existingMapping.roleId);

    if (mappedRole) {
      const copiedOverwriteCount = await copyTemplatePermissionOverwrites(
        guild,
        templateRole.id,
        mappedRole.id,
        data.run_id,
        failures,
      );

      return {
        copiedOverwriteCount,
        created: false,
        failures,
        role: mappedRole,
        roleName: mappedRole.name,
        templateRole,
      };
    }
  }

  const roleName = createRunRoleName(data);
  const role = await createRunRoleFromTemplate(
    guild,
    templateRole,
    roleName,
    data.run_id,
  );
  const copiedOverwriteCount = await copyTemplatePermissionOverwrites(
    guild,
    templateRole.id,
    role.id,
    data.run_id,
    failures,
  );
  const now = new Date().toISOString();

  await options.context.guildRunRoles?.upsert({
    createdAt: existingMapping?.createdAt ?? now,
    discordGuildId: data.discord_guild_id,
    roleId: role.id,
    roleName: role.name,
    runId: data.run_id,
    status: "active",
    templateRoleId: templateRole.id,
    updatedAt: now,
  });

  return {
    copiedOverwriteCount,
    created: true,
    failures,
    role,
    roleName: role.name,
    templateRole,
  };
}

async function deleteRunRole(
  options: GuildAutomationProcessorOptions,
  data: GuildRunCompletedData,
  settings: GuildSettings,
): Promise<ActionResult> {
  const baseResult = {
    discordGuildId: data.discord_guild_id,
    runId: data.run_id,
    type: data.type,
  };

  if (!options.context.guildRunRoles) {
    const result = {
      ...baseResult,
      deletedRoleCount: 0,
      failedRoleCount: 0,
      skippedReason: "run_role_store_not_configured",
    };

    recordGuildAutomationIssue(options, {
      action: "run_role_cleanup",
      data,
      errorCode: "run_role_store_not_configured",
      message: "Run role database is not configured.",
      severity: "error",
    });
    await sendBotLogMessage(
      options,
      settings.botLogChannelId,
      buildRunRoleCleanupLogMessage(data, result),
    );

    return result;
  }

  const mapping = await options.context.guildRunRoles.get(
    data.discord_guild_id,
    data.run_id,
  );

  if (!mapping || mapping.status === "deleted") {
    const result = {
      ...baseResult,
      deletedRoleCount: 0,
      failedRoleCount: 0,
      skippedReason: "run_role_mapping_not_found",
    };

    await sendBotLogMessage(
      options,
      settings.botLogChannelId,
      buildRunRoleCleanupLogMessage(data, result),
    );

    return result;
  }

  const failures: RunReminderFailure[] = [];
  let deletedRoleCount = 0;

  try {
    const guild = await fetchGuildRunReminderGuild(options.client, data.discord_guild_id);
    const role = await fetchGuildRole(guild, mapping.roleId);

    if (role?.delete) {
      await role.delete(`FullParty run ${String(data.run_id)} ended.`);
      deletedRoleCount = 1;
    } else if (role) {
      failures.push({
        discordUserId: "*",
        error: `Discord role ${mapping.roleId} cannot be deleted by this bot.`,
      });
    }
  } catch (error) {
    failures.push({
      discordUserId: "*",
      error: getErrorMessage(error),
    });
  }

  if (failures.length === 0) {
    await options.context.guildRunRoles.markDeleted(data.discord_guild_id, data.run_id);
  }

  const result = {
    ...baseResult,
    deletedRoleCount,
    failedRoleCount: failures.length,
    failures,
    roleId: mapping.roleId,
    roleName: mapping.roleName,
  };

  if (failures.length > 0) {
    recordGuildAutomationIssue(options, {
      action: "run_role_cleanup",
      data,
      details: result,
      errorCode: "run_role_cleanup_failed",
      message: `${String(failures.length)} run role cleanup issue(s) occurred.`,
      severity: "error",
    });
  }

  await sendBotLogMessage(
    options,
    settings.botLogChannelId,
    buildRunRoleCleanupLogMessage(data, result),
  );

  return result;
}

async function syncRunReminderNicknames(
  options: GuildAutomationProcessorOptions,
  data: GuildRunReminderData,
  settings: GuildSettings,
): Promise<ActionResult> {
  const targets = getRunReminderNicknameTargets(data);
  const baseResult = {
    nicknameRequestedUserCount: targets.length,
    nicknameSyncEnabled: settings.syncDiscordNamesToFf14,
  };

  if (!settings.syncDiscordNamesToFf14) {
    return {
      ...baseResult,
      nicknameFailedUserCount: 0,
      nicknameSkippedReason: "nickname_sync_disabled",
      nicknameSkippedUserCount: targets.length,
      nicknameSyncedUserCount: 0,
    };
  }

  if (targets.length === 0) {
    const result = {
      ...baseResult,
      nicknameFailedUserCount: 0,
      nicknameProcessingTimeMs: 0,
      nicknameSkippedReason: "no_nickname_targets",
      nicknameSkippedUserCount: 0,
      nicknameSyncedUserCount: 0,
    };

    await sendBotLogMessage(
      options,
      settings.botLogChannelId,
      buildRunReminderNicknameSyncLogMessage(data, result),
    );

    return result;
  }

  const failures: { discordUserId: string; error: string }[] = [];
  const startedAt = Date.now();
  let skippedUserCount = 0;
  let syncedUserCount = 0;

  try {
    const guild = await fetchGuildRunReminderGuild(options.client, data.discord_guild_id);

    for (const target of targets) {
      try {
        const member = await guild.members.fetch(target.discordUserId);
        const currentNickname = getCurrentNickname(member);

        if (currentNickname === target.nickname) {
          skippedUserCount += 1;
          continue;
        }

        if (!isNicknameSyncableMember(member)) {
          throw new Error(
            `Discord member ${target.discordUserId} cannot have nicknames managed.`,
          );
        }

        await member.setNickname(
          target.nickname,
          `FullParty ${data.reminder_type} nickname sync for run ${String(data.run_id)}`,
        );
        syncedUserCount += 1;
      } catch (error) {
        failures.push({
          discordUserId: target.discordUserId,
          error: getErrorMessage(error),
        });
      }
    }
  } catch (error) {
    failures.push({
      discordUserId: "*",
      error: getErrorMessage(error),
    });
  }

  const result = {
    ...baseResult,
    nicknameFailedUserCount: failures.length,
    nicknameFailures: failures,
    nicknameProcessingTimeMs: Date.now() - startedAt,
    nicknameSkippedUserCount: skippedUserCount,
    nicknameSyncedUserCount: syncedUserCount,
  };

  if (failures.length > 0) {
    recordGuildAutomationIssue(options, {
      affectsHealth: false,
      action: "nickname_sync",
      data,
      details: result,
      errorCode: "nickname_sync_partial_failure",
      message: `${String(failures.length)} nickname sync issue(s) occurred.`,
      severity: syncedUserCount > 0 || skippedUserCount > 0 ? "warn" : "error",
    });
  }

  await sendBotLogMessage(
    options,
    settings.botLogChannelId,
    buildRunReminderNicknameSyncLogMessage(data, result),
  );

  return result;
}

function getRunReminderDiscordUserIds(data: GuildRunReminderData): string[] {
  return Array.from(
    new Set([
      ...data.discord_user_ids,
      ...data.participants.flatMap((participant) =>
        participant.discord_user_id ? [participant.discord_user_id] : [],
      ),
    ]),
  );
}

type NicknameSyncTarget = {
  discordUserId: string;
  nickname: string;
};

function getRunReminderNicknameTargets(data: GuildRunReminderData): NicknameSyncTarget[] {
  const targetsByUserId = new Map<string, NicknameSyncTarget>();

  for (const participant of data.participants) {
    const character = getParticipantCharacter(participant);

    if (!participant.discord_user_id || !character) {
      continue;
    }

    const nickname = formatCharacterNickname(character);

    if (!nickname) {
      continue;
    }

    targetsByUserId.set(participant.discord_user_id, {
      discordUserId: participant.discord_user_id,
      nickname,
    });
  }

  return [...targetsByUserId.values()];
}

function formatCharacterNickname(character: {
  name: string;
  world: string;
}): string | undefined {
  const name = character.name.trim();
  const world = character.world.trim();

  if (!name || !world) {
    return undefined;
  }

  const suffix = ` [${world}]`;
  const fullNickname = `${name}${suffix}`;

  if (fullNickname.length <= discordNicknameLimit) {
    return fullNickname;
  }

  const maxNameLength = discordNicknameLimit - suffix.length;

  if (maxNameLength <= 0) {
    return fullNickname.slice(0, discordNicknameLimit).trim();
  }

  return `${name.slice(0, maxNameLength).trim()}${suffix}`;
}

async function fetchGuildRole(
  guild: GuildRunReminderGuild,
  roleId: string,
): Promise<GuildRunRole | undefined> {
  const cachedRole = guild.roles?.cache?.get(roleId);

  if (isGuildRunRole(cachedRole)) {
    return cachedRole;
  }

  const fetchedRole = await guild.roles?.fetch?.(roleId);

  return isGuildRunRole(fetchedRole) ? fetchedRole : undefined;
}

function getRunRolePreflightFailure(
  guild: GuildRunReminderGuild,
  templateRole: GuildRunRole,
): string | undefined {
  const botMember = guild.members.me;

  if (
    botMember?.permissions &&
    !botMember.permissions.has(PermissionFlagsBits.ManageRoles)
  ) {
    return "bot_missing_manage_roles";
  }

  const botHighestRole = botMember?.roles?.highest;

  if (
    botHighestRole?.comparePositionTo &&
    botHighestRole.comparePositionTo(templateRole) <= 0
  ) {
    return "template_role_not_below_bot";
  }

  return undefined;
}

async function createRunRoleFromTemplate(
  guild: GuildRunReminderGuild,
  templateRole: GuildRunRole,
  roleName: string,
  runId: number,
): Promise<GuildRunRole> {
  if (!guild.roles?.create) {
    throw new Error("Discord guild roles cannot be managed by this bot.");
  }

  const createOptions: GuildRoleCreateOptions = {
    name: roleName,
    permissions: formatPermissionValue(templateRole.permissions),
    reason: `FullParty temporary run role for run ${String(runId)}.`,
  };

  if (typeof templateRole.color === "number") {
    createOptions.color = templateRole.color;
  }

  if (typeof templateRole.hoist === "boolean") {
    createOptions.hoist = templateRole.hoist;
  }

  if (typeof templateRole.mentionable === "boolean") {
    createOptions.mentionable = templateRole.mentionable;
  }

  const role = await guild.roles.create(createOptions);

  if (!isGuildRunRole(role)) {
    throw new Error("Discord did not return a manageable run role.");
  }

  return role;
}

async function copyTemplatePermissionOverwrites(
  guild: GuildRunReminderGuild,
  templateRoleId: string,
  runRoleId: string,
  runId: number,
  failures: RunReminderFailure[],
): Promise<number> {
  const channels = await fetchGuildChannels(guild);
  let copiedOverwriteCount = 0;

  for (const channel of channels) {
    if (!isPermissionOverwriteChannel(channel)) {
      continue;
    }

    const templateOverwrite = getTemplatePermissionOverwrite(channel, templateRoleId);

    if (!templateOverwrite) {
      continue;
    }

    if (!channel.permissionOverwrites?.edit) {
      failures.push({
        discordUserId: "*",
        error: `Channel ${channel.name ?? channel.id} permissions cannot be edited.`,
      });
      continue;
    }

    try {
      await channel.permissionOverwrites.edit(
        runRoleId,
        createPermissionOverwriteOptions(templateOverwrite),
        `FullParty copied template role overwrites for run ${String(runId)}.`,
      );
      copiedOverwriteCount += 1;
    } catch (error) {
      failures.push({
        discordUserId: "*",
        error: `Unable to copy permissions for ${channel.name ?? channel.id}: ${getErrorMessage(error)}`,
      });
    }
  }

  return copiedOverwriteCount;
}

async function fetchGuildChannels(guild: GuildRunReminderGuild): Promise<unknown[]> {
  const channels = await guild.channels?.fetch();

  if (!channels) {
    return [];
  }

  if (Array.isArray(channels)) {
    return [...(channels as unknown[])];
  }

  if (channels instanceof Map) {
    return [...(channels as Map<unknown, unknown>).values()];
  }

  if (hasValuesFunction(channels)) {
    return [...channels.values()];
  }

  return [];
}

function hasValuesFunction(value: unknown): value is { values(): Iterable<unknown> } {
  return isRecord(value) && typeof value.values === "function";
}

function getTemplatePermissionOverwrite(
  channel: GuildPermissionOverwriteChannel,
  templateRoleId: string,
): GuildPermissionOverwrite | undefined {
  const overwrite = channel.permissionOverwrites?.cache?.get(templateRoleId);

  if (!isGuildPermissionOverwrite(overwrite)) {
    return undefined;
  }

  return overwrite;
}

function createRunRoleName(data: GuildRunReminderData): string {
  const activityName =
    data.activity_title ?? data.activity ?? `Run #${String(data.run_id)}`;
  const time = formatRunRoleStartTime(data.starts_at);
  const roleName = `FullParty: ${activityName}${time ? ` ${time}` : ""}`;

  return truncateText(roleName, 100);
}

function formatRunRoleStartTime(startsAt: string | undefined): string | undefined {
  if (!startsAt) {
    return undefined;
  }

  const date = new Date(startsAt);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return `${date.getUTCHours().toString().padStart(2, "0")}:${date
    .getUTCMinutes()
    .toString()
    .padStart(2, "0")} UTC`;
}

function formatPermissionValue(value: PermissionOverwriteValue | undefined): string {
  const bitfield = value?.bitfield;

  if (typeof bitfield === "bigint" || typeof bitfield === "number") {
    return bitfield.toString();
  }

  if (typeof bitfield === "string") {
    return bitfield;
  }

  if (typeof value?.toString === "function") {
    return value.toString();
  }

  return "0";
}

function createPermissionOverwriteOptions(
  overwrite: GuildPermissionOverwrite,
): Record<string, boolean> {
  const options: Record<string, boolean> = {};

  for (const permission of getPermissionNames(overwrite.allow)) {
    options[permission] = true;
  }

  for (const permission of getPermissionNames(overwrite.deny)) {
    options[permission] = false;
  }

  return options;
}

function getPermissionNames(
  value: PermissionOverwriteValue | undefined,
): ReturnType<PermissionsBitField["toArray"]> {
  const bitfield = getPermissionBitfield(value);

  if (bitfield === 0n) {
    return [];
  }

  return new PermissionsBitField(bitfield).toArray();
}

function getPermissionBitfield(value: PermissionOverwriteValue | undefined): bigint {
  const bitfield = value?.bitfield;

  if (typeof bitfield === "bigint") {
    return bitfield;
  }

  if (typeof bitfield === "number") {
    return BigInt(bitfield);
  }

  if (typeof bitfield === "string" && /^\d+$/u.test(bitfield)) {
    return BigInt(bitfield);
  }

  if (typeof value?.toString === "function") {
    const stringValue = value.toString();

    if (/^\d+$/u.test(stringValue)) {
      return BigInt(stringValue);
    }
  }

  return 0n;
}

function isGuildRunRole(value: unknown): value is GuildRunRole {
  return (
    isRecord(value) && typeof value.id === "string" && typeof value.name === "string"
  );
}

function isGuildPermissionOverwrite(value: unknown): value is GuildPermissionOverwrite {
  return isRecord(value) && typeof value.id === "string";
}

function isPermissionOverwriteChannel(
  value: unknown,
): value is GuildPermissionOverwriteChannel {
  return isRecord(value) && typeof value.id === "string";
}

function createUnknownRole(roleId: string): GuildRunRole {
  return {
    id: roleId,
    name: roleId,
  };
}

async function fetchGuildRunReminderGuild(
  client: Client,
  guildId: string,
): Promise<GuildRunReminderGuild> {
  const guild = await client.guilds.fetch(guildId);

  if (!isGuildRunReminderGuild(guild)) {
    throw new Error(`Discord guild ${guildId} cannot be used for run reminder sync.`);
  }

  return guild;
}

function isGuildRunReminderGuild(value: unknown): value is GuildRunReminderGuild {
  return (
    isRecord(value) &&
    isRecord(value.members) &&
    typeof value.members.fetch === "function"
  );
}

function isRoleAssignableMember(
  value: GuildRunReminderMember,
): value is GuildRunReminderMember & {
  roles: { add(roleId: string, reason?: string): Promise<unknown> };
} {
  return isRecord(value.roles) && typeof value.roles.add === "function";
}

function isNicknameSyncableMember(
  value: GuildRunReminderMember,
): value is GuildRunReminderMember & {
  setNickname(nickname: string, reason?: string): Promise<unknown>;
} {
  return typeof value.setNickname === "function";
}

function getCurrentNickname(member: GuildRunReminderMember): string | undefined {
  return member.nickname ?? member.displayName;
}

async function sendBotLogMessage(
  options: GuildAutomationProcessorOptions,
  channelId: string | undefined,
  message: MessageCreateOptions,
  metadata: GuildMessageTelemetryMetadata = {},
): Promise<void> {
  const messageType = metadata.messageType ?? "bot_log";

  if (!channelId) {
    recordAdminGuildMessage(options.context.adminStore, options.context.logger, {
      discordGuildId: metadata.discordGuildId,
      messageType,
      status: "skipped",
    });
    return;
  }

  try {
    const channel = await options.client.channels.fetch(channelId);

    if (isSendableChannel(channel)) {
      const sentMessage = await channel.send(message);

      recordAdminGuildMessage(options.context.adminStore, options.context.logger, {
        channelId,
        discordGuildId: metadata.discordGuildId,
        messageId: getSentMessageId(sentMessage),
        messageType,
        status: "sent",
      });
      return;
    }

    recordAdminGuildMessage(options.context.adminStore, options.context.logger, {
      channelId,
      discordGuildId: metadata.discordGuildId,
      errorCode: "channel_not_sendable",
      messageType,
      status: "failed",
    });
  } catch (error) {
    recordAdminGuildMessage(options.context.adminStore, options.context.logger, {
      channelId,
      discordGuildId: metadata.discordGuildId,
      errorCode: getDiscordApiErrorCode(error),
      errorMessage: getErrorMessage(error),
      messageType,
      status: "failed",
    });
    options.context.logger.warn("Unable to send bot-log message.", {
      channelId,
      error,
    });
  }
}

function getSentMessageId(value: unknown): string | undefined {
  return isRecord(value) ? getStringProperty(value, "id") : undefined;
}

function isSendableChannel(value: unknown): value is SendableChannel {
  return isRecord(value) && typeof value.send === "function";
}

function buildGuildRunAutomationStartedMessage(
  data: GuildRunReminderData,
): MessageCreateOptions {
  const runName = getRunAutomationActivityTitle(data);
  const runLabel =
    data.reminder_type === "starting_now"
      ? `Run #${String(data.run_id)} Starting Now`
      : `Upcoming Run #${String(data.run_id)}`;
  const startsLine = formatRunStartsLine(data.starts_at);

  return {
    allowedMentions: {
      parse: [],
    },
    content: [
      `⚙️ Automation started for ${runLabel}${runName ? `: ${runName}` : ""}.`,
      startsLine,
      "Role assignment and nickname sync status will follow here.",
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n"),
  };
}

function buildRunReminderRoleSyncLogMessage(
  data: GuildRunReminderData,
  result: ActionResult,
): MessageCreateOptions {
  const assignedUserCount =
    typeof result.assignedUserCount === "number" ? result.assignedUserCount : 0;
  const failedUserCount =
    typeof result.failedUserCount === "number" ? result.failedUserCount : 0;
  const requestedUserCount =
    typeof result.requestedUserCount === "number" ? result.requestedUserCount : 0;
  const copiedOverwriteCount =
    typeof result.copiedOverwriteCount === "number" ? result.copiedOverwriteCount : 0;
  const createdRunRole = result.createdRunRole === true;
  const dryRun = result.roleDryRun === true;
  const roleId = getResultString(result, "roleId");
  const roleName = getResultString(result, "roleName");
  const skippedReason = getResultString(result, "skippedReason");
  const templateRoleId = getResultString(result, "templateRoleId");
  const failures = getResultFailures(result, "failures");
  const unlinkedCount = getLooseNumber(data, "unlinked_count");
  const status = getRoleSyncStatus({
    assignedUserCount,
    failedUserCount,
    requestedUserCount,
    skippedReason,
  });
  const successfulAssignments = assignedUserCount;
  const fields: APIEmbedField[] = [
    {
      inline: true,
      name: dryRun ? "✅ Eligible Assignments" : "✅ Successful Assignments",
      value: `${String(successfulAssignments)} ${formatPlural(successfulAssignments, "user")}\n${dryRun ? "would assign" : "assigned"}`,
    },
    {
      inline: true,
      name: dryRun ? "❌ Failed Checks" : "❌ Failed Assignments",
      value: `${String(failedUserCount)} ${formatPlural(failedUserCount, "user")}\nfailed`,
    },
    {
      inline: true,
      name: "📈 Success Rate",
      value: `${formatPercent(successfulAssignments, requestedUserCount)}\n${dryRun ? "check rate" : "assignment rate"}`,
    },
    {
      inline: true,
      name: "🛡️ Run Role",
      value: roleId
        ? [`<@&${roleId}>`, roleName ? `\`${roleName}\`` : undefined]
            .filter((value): value is string => Boolean(value))
            .join("\n")
        : dryRun
          ? "_Dry run only_"
          : "_Not created_",
    },
    {
      inline: true,
      name: "📋 Template",
      value: templateRoleId ? `<@&${templateRoleId}>` : "_Not configured_",
    },
    {
      inline: true,
      name: "🔐 Channel Access",
      value: dryRun
        ? "Not copied\ndry run"
        : `${String(copiedOverwriteCount)} ${formatPlural(copiedOverwriteCount, "overwrite")}\ncopied`,
    },
    {
      inline: true,
      name: "✨ Role State",
      value: dryRun
        ? "Not created (dry run)"
        : skippedReason
          ? "Not created"
          : createdRunRole
            ? "Created for this run"
            : "Reused for this run",
    },
  ];

  if (dryRun) {
    fields.push({
      inline: false,
      name: "ℹ️ Note",
      value:
        "Dry run only. No roles were created, channel overwrites copied, or members assigned.",
    });
  } else if (skippedReason) {
    fields.push({
      inline: false,
      name: "ℹ️ Note",
      value: formatRunReminderSkippedReason(skippedReason),
    });
  } else if (failedUserCount > 0) {
    fields.push({
      inline: false,
      name: "ℹ️ Note",
      value:
        "Some role assignments failed. Common causes: user left the server, missing bot permissions, role hierarchy, or Discord API limits.",
    });
  }

  const failureField = createFailuresField(failures);

  if (failureField) {
    fields.push(failureField);
  }

  return createBotLogEmbedMessage({
    color: status.color,
    description: createRunReminderDescription(data, requestedUserCount, skippedReason),
    failureDetailsId: createAutomationFailureDetailsId({
      context: createAutomationFailureDetailsContext(data),
      sections: [
        createAutomationFailureSection("Role Assignment Failures", failures),
        createUnlinkedPlacedUsersSection(data, unlinkedCount),
      ],
      title: "Role Assignment Failure Details",
    }),
    fields,
    title: `${dryRun ? "🧪 Role Assignment Dry Run" : "🛡️ Role Assignment"} - ${status.titleSuffix}`,
  });
}

function buildRunReminderNicknameSyncLogMessage(
  data: GuildRunReminderData,
  result: ActionResult,
): MessageCreateOptions {
  const failedUserCount =
    typeof result.nicknameFailedUserCount === "number"
      ? result.nicknameFailedUserCount
      : 0;
  const requestedUserCount =
    typeof result.nicknameRequestedUserCount === "number"
      ? result.nicknameRequestedUserCount
      : 0;
  const skippedUserCount =
    typeof result.nicknameSkippedUserCount === "number"
      ? result.nicknameSkippedUserCount
      : 0;
  const syncedUserCount =
    typeof result.nicknameSyncedUserCount === "number"
      ? result.nicknameSyncedUserCount
      : 0;
  const skippedReason = getResultString(result, "nicknameSkippedReason");
  const failures = getResultFailures(result, "nicknameFailures");
  const status = getNicknameSyncStatus({
    failedUserCount,
    requestedUserCount,
    skippedReason,
    skippedUserCount,
    syncedUserCount,
  });
  const successfulUpdates = syncedUserCount + skippedUserCount;
  const fields: APIEmbedField[] = [
    {
      inline: true,
      name: "✅ Successful Updates",
      value: `${String(syncedUserCount)} ${formatPlural(syncedUserCount, "user")}\nupdated`,
    },
    {
      inline: true,
      name: "☑️ Already Correct",
      value: `${String(skippedUserCount)} ${formatPlural(skippedUserCount, "user")}\nunchanged`,
    },
    {
      inline: true,
      name: "❌ Failed Updates",
      value: `${String(failedUserCount)} ${formatPlural(failedUserCount, "user")}\nfailed`,
    },
    {
      inline: true,
      name: "📈 Success Rate",
      value: `${formatPercent(successfulUpdates, requestedUserCount)}\nhandled`,
    },
    {
      inline: true,
      name: "🔄 Update Mode",
      value: "Primary character\nName Surname [World]",
    },
  ];

  if (skippedReason) {
    fields.push({
      inline: false,
      name: "ℹ️ Note",
      value: formatRunReminderSkippedReason(skippedReason),
    });
  } else if (failedUserCount > 0) {
    fields.push({
      inline: false,
      name: "ℹ️ Note",
      value:
        "Some nickname updates failed. Common causes: user left the server, missing Manage Nicknames permission, role hierarchy, or Discord API limits.",
    });
  }

  const failureField = createFailuresField(failures);

  if (failureField) {
    fields.push(failureField);
  }

  return createBotLogEmbedMessage({
    color: status.color,
    description: createRunReminderDescription(data, requestedUserCount, skippedReason),
    failureDetailsId: createAutomationFailureDetailsId({
      context: createAutomationFailureDetailsContext(data),
      sections: [createAutomationFailureSection("Nickname Sync Failures", failures)],
      title: "Nickname Sync Failure Details",
    }),
    fields,
    title: `🏷️ Nickname Synchronization - ${status.titleSuffix}`,
  });
}

function buildRunRoleCleanupLogMessage(
  data: GuildRunCompletedData,
  result: ActionResult,
): MessageCreateOptions {
  const deletedRoleCount =
    typeof result.deletedRoleCount === "number" ? result.deletedRoleCount : 0;
  const failedRoleCount =
    typeof result.failedRoleCount === "number" ? result.failedRoleCount : 0;
  const roleId = getResultString(result, "roleId");
  const roleName = getResultString(result, "roleName");
  const skippedReason = getResultString(result, "skippedReason");
  const failures = getResultFailures(result, "failures");
  const status = getCleanupStatus({ deletedRoleCount, failedRoleCount, skippedReason });
  const fields: APIEmbedField[] = [
    {
      inline: true,
      name: "🧹 Deleted Roles",
      value: `${String(deletedRoleCount)} ${formatPlural(deletedRoleCount, "role")}\ndeleted`,
    },
    {
      inline: true,
      name: "❌ Failed Deletes",
      value: `${String(failedRoleCount)} ${formatPlural(failedRoleCount, "role")}\nfailed`,
    },
    {
      inline: true,
      name: "🛡️ Run Role",
      value: roleId
        ? [`<@&${roleId}>`, roleName ? `\`${roleName}\`` : undefined]
            .filter((value): value is string => Boolean(value))
            .join("\n")
        : "_No active role_",
    },
  ];

  if (skippedReason) {
    fields.push({
      inline: false,
      name: "ℹ️ Note",
      value: formatRunReminderSkippedReason(skippedReason),
    });
  }

  const failureField = createFailuresField(failures);

  if (failureField) {
    fields.push(failureField);
  }

  return createBotLogEmbedMessage({
    color: status.color,
    description: createRunCompletedDescription(data),
    failureDetailsId: createAutomationFailureDetailsId({
      context: createRunCompletedFailureDetailsContext(data),
      sections: [createAutomationFailureSection("Run Role Cleanup Failures", failures)],
      title: "Run Role Cleanup Failure Details",
    }),
    fields,
    title: `🧹 Run Role Cleanup - ${status.titleSuffix}`,
  });
}

type SyncStatus = {
  color: number;
  titleSuffix: string;
};

type RoleSyncStatusInput = {
  assignedUserCount: number;
  failedUserCount: number;
  requestedUserCount: number;
  skippedReason: string | undefined;
};

type NicknameSyncStatusInput = {
  failedUserCount: number;
  requestedUserCount: number;
  skippedReason: string | undefined;
  skippedUserCount: number;
  syncedUserCount: number;
};

type CleanupStatusInput = {
  deletedRoleCount: number;
  failedRoleCount: number;
  skippedReason: string | undefined;
};

type RunReminderFailure = {
  discordUserId: string;
  error: string;
};

function createAutomationFailureDetailsId(input: {
  context?: string | undefined;
  sections: (AutomationFailureDetailsSection | undefined)[];
  title: string;
}): string | undefined {
  const sections = input.sections.filter(
    (section): section is AutomationFailureDetailsSection =>
      section !== undefined && section.details.length > 0,
  );

  if (sections.length === 0) {
    return undefined;
  }

  return storeAutomationFailureDetails({
    context: input.context,
    sections,
    title: input.title,
  });
}

function createAutomationFailureSection(
  title: string,
  failures: RunReminderFailure[],
): AutomationFailureDetailsSection | undefined {
  if (failures.length === 0) {
    return undefined;
  }

  return {
    details: failures.map((failure) => ({
      reason: failure.error,
      subject:
        failure.discordUserId === "*"
          ? "General automation failure"
          : failure.discordUserId,
    })),
    title,
  };
}

function createUnlinkedPlacedUsersSection(
  data: GuildRunReminderData,
  unlinkedCount: number,
): AutomationFailureDetailsSection | undefined {
  const unlinkedParticipants = data.unlinked_participants;

  if (unlinkedParticipants.length > 0) {
    return {
      details: unlinkedParticipants.map((participant) => {
        const characterLabel = formatParticipantCharacterLabel(participant);
        const subject = characterLabel ?? "Unlinked placed user";
        const context = [
          typeof participant.is_group_member === "boolean"
            ? `Group Member: ${participant.is_group_member ? "yes" : "no"}`
            : undefined,
          participant.group_role ? `Group Role: ${participant.group_role}` : undefined,
        ]
          .filter((value): value is string => Boolean(value))
          .join(", ");

        return {
          reason: `No Discord Account Linked.${context ? ` ${context}.` : ""}`,
          subject,
        };
      }),
      title: "Users Not Linked On FullParty",
    };
  }

  if (unlinkedCount <= 0) {
    return undefined;
  }

  return {
    details: [
      {
        reason:
          "FullParty reported placed users without an active linked Discord account. The site only sends this as a count, so the bot cannot name those users here yet.",
        subject: `${String(unlinkedCount)} unlinked ${formatPlural(unlinkedCount, "user")}`,
      },
    ],
    title: "Users Not Linked On FullParty",
  };
}

function formatParticipantCharacterLabel(participant: {
  character?: { name: string; world: string } | undefined;
  primary_character?: { name: string; world: string } | undefined;
}): string | undefined {
  const character = getParticipantCharacter(participant);

  if (!character) {
    return undefined;
  }

  return `${character.name} [${character.world}]`;
}

function getParticipantCharacter(participant: {
  character?: { name: string; world: string } | undefined;
  primary_character?: { name: string; world: string } | undefined;
}): { name: string; world: string } | undefined {
  return participant.primary_character ?? participant.character;
}

function createAutomationFailureDetailsContext(data: GuildRunReminderData): string {
  const runTitle = getRunAutomationActivityTitle(data);
  const runLabel = runTitle
    ? `Run #${String(data.run_id)} - ${runTitle}`
    : `Run #${String(data.run_id)}`;

  return [
    runLabel,
    formatReminderType(data.reminder_type).replaceAll("*", ""),
    formatRunStartsLine(data.starts_at)?.replace("**Starts:** ", "Starts: "),
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

function createRunCompletedFailureDetailsContext(data: GuildRunCompletedData): string {
  const runTitle = getRunAutomationActivityTitle(data);
  const runLabel = runTitle
    ? `Run #${String(data.run_id)} - ${runTitle}`
    : `Run #${String(data.run_id)}`;

  return [
    runLabel,
    data.type === "runs.cancelled" ? "Cancelled" : "Completed",
    data.group_slug ? `Group: ${data.group_slug}` : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

function getRoleSyncStatus(input: RoleSyncStatusInput): SyncStatus {
  if (input.skippedReason) {
    return { color: 0x64748b, titleSuffix: "Skipped" };
  }

  if (input.failedUserCount > 0 && input.assignedUserCount === 0) {
    return { color: 0xef4444, titleSuffix: "Failed" };
  }

  if (input.failedUserCount > 0) {
    return { color: 0xf59e0b, titleSuffix: "Partial" };
  }

  return { color: 0x22c55e, titleSuffix: "Complete" };
}

function getNicknameSyncStatus(input: NicknameSyncStatusInput): SyncStatus {
  if (input.skippedReason) {
    return { color: 0x64748b, titleSuffix: "Skipped" };
  }

  if (input.failedUserCount > 0 && input.syncedUserCount + input.skippedUserCount === 0) {
    return { color: 0xef4444, titleSuffix: "Failed" };
  }

  if (input.failedUserCount > 0) {
    return { color: 0xf59e0b, titleSuffix: "Partial" };
  }

  return { color: 0x22c55e, titleSuffix: "Complete" };
}

function getCleanupStatus(input: CleanupStatusInput): SyncStatus {
  if (input.skippedReason) {
    return { color: 0x64748b, titleSuffix: "Skipped" };
  }

  if (input.failedRoleCount > 0) {
    return { color: 0xef4444, titleSuffix: "Failed" };
  }

  return { color: 0x22c55e, titleSuffix: "Complete" };
}

function createBotLogEmbedMessage(options: {
  color: number;
  description: string;
  failureDetailsId?: string | undefined;
  fields: APIEmbedField[];
  title: string;
}): MessageCreateOptions {
  const embed: APIEmbed = {
    color: options.color,
    description: options.description,
    fields: options.fields,
    footer: {
      text: "FullParty • Guild Automation",
    },
    title: options.title,
  };

  return {
    allowedMentions: {
      parse: [],
    },
    ...(options.failureDetailsId
      ? { components: [createFailureDetailsButtonRow(options.failureDetailsId)] }
      : {}),
    embeds: [embed],
  };
}

function createFailureDetailsButtonRow(detailsId: string) {
  return {
    components: [
      {
        custom_id: createAutomationFailureDetailsCustomId(detailsId),
        emoji: {
          name: "🔎",
        },
        label: "Failure Details",
        style: 2,
        type: 2,
      },
    ],
    type: 1,
  } as const;
}

function createRunReminderDescription(
  data: GuildRunReminderData,
  requestedUserCount: number,
  skippedReason?: string,
): string {
  const action = skippedReason ? "Checked" : "Processed";
  const runLine = [
    `**Run #${String(data.run_id)}**`,
    formatReminderType(data.reminder_type),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" • ");

  return [
    runLine,
    formatRunStartsLine(data.starts_at),
    data.group_slug ? `**Group:** ${data.group_slug}` : undefined,
    `${action} **${String(requestedUserCount)}** ${formatPlural(requestedUserCount, "user")}.`,
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

function getRunAutomationActivityTitle(
  data: GuildRunReminderData | GuildRunCompletedData,
): string | undefined {
  return data.activity_title ?? data.activity;
}

function formatRunStartsLine(startsAt: string | undefined): string | undefined {
  const timestamp = formatDiscordDateTime(startsAt);

  return timestamp ? `**Starts:** ${timestamp}` : undefined;
}

function createRunCompletedDescription(data: GuildRunCompletedData): string {
  const status = data.type === "runs.cancelled" ? "Cancelled" : "Completed";
  const icon = data.type === "runs.cancelled" ? "🚫" : "✅";

  return [
    `**Run #${String(data.run_id)}** • ${icon} **${status}**`,
    data.group_slug ? `**Group:** ${data.group_slug}` : undefined,
    "Cleaning up the temporary FullParty run role.",
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

function createFailuresField(failures: RunReminderFailure[]): APIEmbedField | undefined {
  if (failures.length === 0) {
    return undefined;
  }

  const visibleFailures = failures.slice(0, 5);
  const hiddenFailureCount = failures.length - visibleFailures.length;
  const lines = visibleFailures.map(
    (failure) => `\`${failure.discordUserId}\`: ${truncateText(failure.error, 120)}`,
  );

  if (hiddenFailureCount > 0) {
    lines.push(`...and ${String(hiddenFailureCount)} more failure(s).`);
  }

  return {
    inline: false,
    name: "Failure Details",
    value: lines.join("\n"),
  };
}

function getResultFailures(result: ActionResult, key: string): RunReminderFailure[] {
  const failures = result[key];

  if (!Array.isArray(failures)) {
    return [];
  }

  return failures.flatMap((failure) => {
    if (!isRecord(failure)) {
      return [];
    }

    const discordUserId = failure.discordUserId;
    const error = failure.error;

    if (typeof discordUserId !== "string" || typeof error !== "string") {
      return [];
    }

    return [{ discordUserId, error }];
  });
}

function getResultString(result: ActionResult, key: string): string | undefined {
  const value = result[key];

  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function getResultNumber(result: ActionResult, key: string): number | undefined {
  const value = result[key];

  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getLooseNumber(value: unknown, key: string): number {
  if (!isRecord(value)) {
    return 0;
  }

  const fieldValue = value[key];

  return typeof fieldValue === "number" && Number.isFinite(fieldValue) ? fieldValue : 0;
}

function formatRunReminderSkippedReason(reason: string): string {
  const knownReasons: Record<string, string> = {
    bot_missing_manage_roles:
      "The bot needs the Manage Roles permission to create, delete, and assign run roles.",
    nickname_sync_disabled: "Nickname sync is disabled in `/setup`.",
    no_discord_users: "FullParty did not include any Discord users for this run.",
    no_nickname_targets:
      "No participants included both a Discord user and primary character to sync.",
    run_role_mapping_not_found:
      "No active temporary role is mapped for this run. It may have already been cleaned up.",
    run_role_store_not_configured:
      "The bot's run-role database is not configured, so temporary run roles cannot be tracked safely.",
    template_role_not_below_bot:
      "The template role must be below the bot's highest role in Discord role settings.",
    template_role_not_found:
      "The configured template role was not found. Re-run `/setup` and choose a valid role.",
    upcoming_raider_role_not_configured:
      "Run role template is not configured in `/setup`.",
  };

  return knownReasons[reason] ?? reason.replaceAll("_", " ");
}

function formatReminderType(reminderType: GuildRunReminderData["reminder_type"]): string {
  return reminderType === "starting_now" ? "🚨 **Starting Now**" : "🕒 **Upcoming**";
}

function formatPercent(successfulCount: number, requestedCount: number): string {
  if (requestedCount === 0) {
    return "0.0%";
  }

  return `${((successfulCount / requestedCount) * 100).toFixed(1)}%`;
}

function formatPlural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function handleHealthcheckRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: WebhookServerOptions,
): void {
  const healthcheckEvent = getSingleHeader(request, "x-fullparty-event");

  if (healthcheckEvent !== integrationHealthcheckEvent) {
    throw new HttpError(
      400,
      "invalid_healthcheck_event",
      `Expected X-FullParty-Event: ${integrationHealthcheckEvent}.`,
    );
  }

  verifyWebhookSignature(
    request,
    Buffer.alloc(0),
    options.webhookSigningSecret,
    options.signatureToleranceSeconds ?? 300,
  );
  sendJson(response, 200, {
    event: integrationHealthcheckEvent,
    ok: true,
    status: "healthy",
  });
}

async function sendUserDm(
  options: WebhookServerOptions,
  discordUserId: string,
  messageOptions: MessageCreateOptions,
  metadata: DmDeliveryMetadata = {},
): Promise<ActionResult> {
  const operation = async () => {
    try {
      const result = await sendUserDmNow(options, discordUserId, messageOptions);

      recordAdminDmDelivery(options.context.adminStore, options.context.logger, {
        discordUserId,
        eventType: metadata.eventType,
        messageId: getResultString(result, "messageId"),
        notificationType: metadata.notificationType,
        occurredAt: new Date().toISOString(),
        sentAt: new Date().toISOString(),
        status: "sent",
      });

      return result;
    } catch (error) {
      recordAdminDmDelivery(options.context.adminStore, options.context.logger, {
        discordUserId,
        errorCode: getDiscordApiErrorCode(error),
        errorMessage: getErrorMessage(error),
        eventType: metadata.eventType,
        notificationType: metadata.notificationType,
        occurredAt: new Date().toISOString(),
        status: "failed",
      });

      throw error;
    }
  };

  if (options.context.userDmRateLimiter) {
    const result = await options.context.userDmRateLimiter.send(discordUserId, operation);

    if (result.queued) {
      recordAdminDmDelivery(options.context.adminStore, options.context.logger, {
        discordUserId,
        eventType: metadata.eventType,
        notificationType: metadata.notificationType,
        occurredAt: new Date().toISOString(),
        queuedAt: new Date().toISOString(),
        status: "queued",
      });
    }

    return result;
  }

  return operation();
}

async function sendUserDmNow(
  options: WebhookServerOptions,
  discordUserId: string,
  messageOptions: MessageCreateOptions,
): Promise<ActionResult> {
  const user = await options.client.users.fetch(discordUserId);

  if (!isSendableUser(user)) {
    throw new HttpError(
      404,
      "user_not_found",
      "Discord user was not found or is not messageable by this bot.",
    );
  }

  const message = await user.send(messageOptions);

  return {
    discordUserId,
    messageId: message.id,
  };
}

function assertJsonContentType(request: IncomingMessage): void {
  const contentType = request.headers["content-type"] ?? "";

  if (!contentType.includes("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "Expected application/json.");
  }
}

async function readRawBody(
  request: IncomingMessage,
  maxBodyBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let byteLength = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));

    byteLength += buffer.byteLength;

    if (byteLength > maxBodyBytes) {
      throw new HttpError(413, "payload_too_large", "Request body is too large.");
    }

    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    throw new HttpError(400, "invalid_json", "Request body is required.");
  }

  return Buffer.concat(chunks);
}

function parseJsonBody(rawBody: Buffer): unknown {
  try {
    return JSON.parse(rawBody.toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
}

function parseEvent(value: unknown): FullpartyEvent {
  const result = fullpartyEventSchema.safeParse(value);

  if (result.success) {
    return result.data;
  }

  const notificationDeliveryResult = notificationDeliveryDataSchema.safeParse(value);

  if (notificationDeliveryResult.success) {
    return {
      data: notificationDeliveryResult.data,
      event: "discord.notification.delivery",
    };
  }

  throw new HttpError(
    400,
    "invalid_event",
    "Request body must include a valid event type.",
    z.treeifyError(result.error),
  );
}

function handleError(
  response: ServerResponse,
  error: unknown,
  options: WebhookServerOptions,
): void {
  if (error instanceof z.ZodError) {
    sendJson(response, 400, {
      details: z.treeifyError(error),
      error: "invalid_payload",
      message: "Event payload is invalid.",
    });
    return;
  }

  if (error instanceof HttpError) {
    sendJson(response, error.statusCode, {
      details: error.details,
      error: error.code,
      message: error.message,
    });
    return;
  }

  options.context.logger.error("Fullparty integration event failed.", {
    error,
  });

  sendJson(response, 500, {
    error: "internal_server_error",
    message: "Unable to process event.",
  });
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);

  response.writeHead(statusCode, {
    "content-length": Buffer.byteLength(payload),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(payload);
}

function isSendableUser(value: unknown): value is SendableUser {
  return isRecord(value) && typeof value.send === "function";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getEventDataType(event: FullpartyEvent): string | undefined {
  if (event.event === "discord.guild.run_cancelled") {
    return "runs.cancelled";
  }

  if (event.event === "discord.guild.run_completed" && !isRecord(event.data)) {
    return "runs.completed";
  }

  if (!isRecord(event.data)) {
    return undefined;
  }

  const dataType = getStringProperty(event.data, "type");

  if (dataType) {
    return dataType;
  }

  if (event.event === "discord.guild.run_completed") {
    return "runs.completed";
  }

  const notification = event.data.notification;

  return isRecord(notification) ? getStringProperty(notification, "type") : undefined;
}

function getStringProperty(
  value: Record<string, unknown>,
  property: string,
): string | undefined {
  const propertyValue = value[property];

  return typeof propertyValue === "string" && propertyValue.trim().length > 0
    ? propertyValue
    : undefined;
}

function getEventErrorCode(error: unknown): string {
  if (error instanceof HttpError) {
    return error.code;
  }

  if (error instanceof z.ZodError) {
    return "invalid_payload";
  }

  return "internal_server_error";
}

function getDiscordApiErrorCode(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const code = error.code;

  if (typeof code === "number" || typeof code === "string") {
    return String(code);
  }

  const rawError = error.rawError;

  if (!isRecord(rawError)) {
    return undefined;
  }

  const rawCode = rawError.code;

  return typeof rawCode === "number" || typeof rawCode === "string"
    ? String(rawCode)
    : undefined;
}

function getFailureSeverity(error: unknown): "warn" | "error" {
  if (error instanceof HttpError && error.statusCode < 500) {
    return "warn";
  }

  if (error instanceof z.ZodError) {
    return "warn";
  }

  return "error";
}

function getRequestId(event: FullpartyEvent): string | undefined {
  return event.requestId ?? event.request_id ?? event.id;
}

function verifyWebhookSignature(
  request: IncomingMessage,
  rawBody: Buffer,
  webhookSigningSecret: string,
  toleranceSeconds: number,
): void {
  const timestamp = getSingleHeader(request, "x-fullparty-timestamp");
  const signature = getSingleHeader(request, "x-fullparty-signature");

  if (!timestamp || !signature) {
    throw new HttpError(
      401,
      "missing_signature",
      "Missing Fullparty webhook signature headers.",
    );
  }

  assertFreshTimestamp(timestamp, toleranceSeconds);

  const expectedSignature = createWebhookSignature(
    timestamp,
    rawBody,
    webhookSigningSecret,
  );

  if (!timingSafeStringEqual(signature.trim().toLowerCase(), expectedSignature)) {
    throw new HttpError(401, "invalid_signature", "Invalid webhook signature.");
  }
}

function createWebhookSignature(
  timestamp: string,
  rawBody: Buffer,
  webhookSigningSecret: string,
): string {
  const digest = createHmac("sha256", webhookSigningSecret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest("hex");

  return `sha256=${digest}`;
}

function assertFreshTimestamp(timestamp: string, toleranceSeconds: number): void {
  const timestampMs = parseWebhookTimestamp(timestamp);
  const ageMs = Math.abs(Date.now() - timestampMs);

  if (ageMs > toleranceSeconds * 1000) {
    throw new HttpError(401, "stale_signature", "Webhook signature timestamp is stale.");
  }
}

function parseWebhookTimestamp(timestamp: string): number {
  const numericTimestamp = Number(timestamp);

  if (Number.isFinite(numericTimestamp)) {
    return numericTimestamp > 1_000_000_000_000
      ? numericTimestamp
      : numericTimestamp * 1000;
  }

  const timestampMs = Date.parse(timestamp);

  if (!Number.isNaN(timestampMs)) {
    return timestampMs;
  }

  throw new HttpError(401, "invalid_timestamp", "Webhook timestamp is invalid.");
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.byteLength !== rightBuffer.byteLength) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getSingleHeader(request: IncomingMessage, header: string): string | undefined {
  const value = request.headers[header];

  if (Array.isArray(value)) {
    return value.at(0);
  }

  return value;
}

function getRequestHost(request: IncomingMessage): string {
  return request.socket.remoteAddress ?? "unknown host";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasOwn<TObject extends object, TKey extends PropertyKey>(
  value: TObject,
  key: TKey,
): value is TObject & Record<TKey, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function formatAddress(address: AddressInfo | null): string {
  if (!address) {
    return "unknown";
  }

  return `${address.address}:${String(address.port)}`;
}

class HttpError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
