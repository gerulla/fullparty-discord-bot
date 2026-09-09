import {
  sendUserDm,
  userAppDisconnectedMessage,
  userAppInstalledMessage,
} from "../dm/deliveryService.js";
import { GuildAutomationService } from "../guildAutomation/automationService.js";
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
  const automation = new GuildAutomationService(options);
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
    await automation.notifyStarted(data);

    return options.context.guildRunReminderQueue
      ? options.context.guildRunReminderQueue.enqueue({ data, kind: "run_reminder" })
      : automation.remind(data);
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
