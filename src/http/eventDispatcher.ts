import {
  adminReportDataSchema,
  adminReportEvent,
  sendAdminReport,
} from "../dm/adminReport.js";
import {
  createUserConnectedMessage,
  createUserDisconnectedMessage,
} from "../discord/linkMessages.js";
import { sendUserDm } from "../dm/deliveryService.js";
import {
  createDiscordLoginMessage,
  discordLoginDataSchema,
  discordLoginEvent,
} from "../dm/discordLogin.js";
import { GuildAutomationService } from "../guildAutomation/automationService.js";
import {
  guildRunParticipantSyncDataSchema,
  runParticipantSyncEvent,
} from "../guildAutomation/runParticipantSyncTypes.js";
import type { GuildRunCompletedData } from "../guildAutomation/runReminderTypes.js";
import {
  guildRunCompletedDataSchema,
  guildRunReminderDataSchema,
} from "../guildAutomation/runReminderTypes.js";
import { disconnectGuildFromFullparty } from "../guildIntegration/disconnectService.js";
import {
  markGuildLinked,
  updateGuildSettingsFromFullparty,
} from "../guildIntegration/settingsService.js";
import {
  createGuildMembershipSnapshotResult,
  createGuildSnapshotResult,
} from "../guildIntegration/snapshotService.js";
import { isRecord } from "../lib/valueReaders.js";
import { NotificationMessageService } from "../notifications/notificationMessageService.js";
import { notificationDeliveryDataSchema } from "../notifications/types.js";
import type { FullpartyEvent } from "./eventSchemas.js";
import {
  guildDisconnectedDataSchema,
  guildMembershipSnapshotRequestedDataSchema,
  guildRunsChangedDataSchema,
  guildRunsChangedEvent,
  guildSettingsUpdatedDataSchema,
  guildSnapshotRequestedDataSchema,
  userAppEventDataSchema,
} from "./eventSchemas.js";
import { HttpError } from "./httpError.js";
import type { ActionResult, WebhookServerOptions } from "./types.js";

export async function dispatchEvent(
  event: FullpartyEvent,
  options: WebhookServerOptions,
): Promise<ActionResult> {
  if (event.event === guildRunsChangedEvent) {
    const data = guildRunsChangedDataSchema.parse(event.data);
    const store = options.context.guildScheduleStore;
    if (!store) {
      throw new HttpError(
        503,
        "schedule_refresh_unavailable",
        "Schedule refresh storage is unavailable. Retry this event later.",
      );
    }

    // Persist the refresh before acknowledging; Discord and FullParty I/O runs in
    // the scheduler. The store only accepts linked guilds using Run Detection.
    const queued = store.requestRunDetectionRefresh(data.discord_guild_id);
    return {
      discordGuildId: data.discord_guild_id,
      queued,
      ...(!queued ? { skipped: true, reason: "run_detection_not_configured" } : {}),
    };
  }

  if (event.event === adminReportEvent) {
    return sendAdminReport(options, adminReportDataSchema.parse(event.data));
  }

  if (event.event === discordLoginEvent) {
    const data = discordLoginDataSchema.parse(event.data);
    if (data.discord_app_installed) {
      return {
        discordUserId: data.discord_user_id,
        skipped: true,
        reason: "discord_app_already_installed",
      };
    }

    return sendUserDm(
      options,
      data.discord_user_id,
      createDiscordLoginMessage(
        data.discord_app_install_url,
        options.fullpartyWebBaseUrl,
        data.account_settings_url,
      ),
      { eventType: event.event, notificationType: event.event },
    );
  }

  const automation = new GuildAutomationService(options);
  if (event.event === runParticipantSyncEvent) {
    return automation.syncParticipant(
      guildRunParticipantSyncDataSchema.parse(event.data),
    );
  }
  if (event.event === "discord.user_app.installed") {
    const data = userAppEventDataSchema.parse(event.data);
    const discordUserId = data.discord_user.id;

    return sendUserDm(
      options,
      discordUserId,
      createUserConnectedMessage({
        fullpartyWebBaseUrl: options.fullpartyWebBaseUrl,
        accountSettingsUrl: data.account_settings_url,
        ...(data.welcome_message ? { welcomeMessage: data.welcome_message } : {}),
      }),
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
      createUserDisconnectedMessage({
        fullpartyWebBaseUrl: options.fullpartyWebBaseUrl,
        feedbackUrl: data.feedback_url,
        disconnectGuideImageUrl: data.disconnect_guide_image_url,
      }),
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
        notificationDeliveryId: data.notification_delivery_id,
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

    if (options.context.guildRunReminderQueue) {
      return options.context.guildRunReminderQueue.enqueue({
        data,
        kind: "run_reminder",
      });
    }

    await automation.notifyStarted(data);
    return automation.remind(data);
  }

  if (
    event.event === "discord.guild.run_completed" ||
    event.event === "discord.guild.run_cancelled"
  ) {
    const data = parseGuildRunCleanupData(event);

    await markGuildLinked(options, data.discord_guild_id);

    return options.context.guildRunReminderQueue
      ? options.context.guildRunReminderQueue.enqueue({ data, kind: "run_completed" })
      : automation.complete(data);
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
