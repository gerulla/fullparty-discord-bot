import type { MessageCreateOptions } from "discord.js";
import { recordAdminGuildMessage } from "../admin/telemetryRecorder.js";
import { getDiscordApiErrorCode, getErrorMessage } from "../lib/errors.js";
import { getStringProperty, isRecord } from "../lib/valueReaders.js";
import type {
  GuildAutomationProcessorOptions,
  GuildMessageTelemetryMetadata,
  SendableChannel,
} from "./types.js";

export async function sendBotLogMessage(
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
