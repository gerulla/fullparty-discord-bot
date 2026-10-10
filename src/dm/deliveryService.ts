import type { Client, MessageCreateOptions } from "discord.js";
import { randomBytes } from "node:crypto";
import type { BotContext } from "../bot/context.js";
import { recordAdminDmDelivery } from "../admin/telemetryRecorder.js";
import { HttpError } from "../http/httpError.js";
import type { UserDmRateLimiterResult } from "./userDmRateLimiter.js";
import { omitUndefined } from "../lib/definedProperties.js";
import { getDiscordApiErrorCode, getErrorMessage } from "../lib/errors.js";
import { isRecord } from "../lib/valueReaders.js";
import { resolveV2MessageIcons, type MessageEmojiSource } from "../discord/v2.js";
import {
  dmDeliveryJobSchema,
  type DmDeliveryJob,
  type DmDeliveryResult,
} from "./deliveryTypes.js";

type DmDeliveryMetadata = {
  eventType?: string | undefined;
  notificationDeliveryId?: number | undefined;
  notificationType?: string | undefined;
};

type SendableUser = {
  send(message: MessageCreateOptions): Promise<{ id: string }>;
};

type DmDeliveryDependencies = {
  client: Pick<Client, "users"> & MessageEmojiSource;
  context: Pick<BotContext, "adminStore" | "logger" | "userDmRateLimiter">;
};

export async function sendUserDm(
  options: DmDeliveryDependencies,
  discordUserId: string,
  messageOptions: MessageCreateOptions,
  metadata: DmDeliveryMetadata = {},
): Promise<DmDeliveryResult | UserDmRateLimiterResult<DmDeliveryResult>> {
  const job = dmDeliveryJobSchema.parse(
    JSON.parse(
      JSON.stringify({
        discordUserId,
        message: {
          ...messageOptions,
          nonce: randomBytes(12).toString("hex"),
          enforceNonce: true,
        },
        metadata,
      }),
    ) as unknown,
  );
  const operation = () => deliverStoredDm(options, job);

  if (options.context.userDmRateLimiter) {
    const result = await options.context.userDmRateLimiter.send(
      discordUserId,
      operation,
      job,
    );

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

export async function deliverStoredDm(
  options: DmDeliveryDependencies,
  job: DmDeliveryJob,
): Promise<DmDeliveryResult> {
  const { discordUserId, message: messageOptions, metadata } = job;
  try {
    const result = await sendUserDmNow(
      options,
      discordUserId,
      omitUndefined(messageOptions),
    );

    recordAdminDmDelivery(options.context.adminStore, options.context.logger, {
      discordUserId,
      eventType: metadata.eventType,
      messageId: result.messageId,
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
}

async function sendUserDmNow(
  options: DmDeliveryDependencies,
  discordUserId: string,
  messageOptions: MessageCreateOptions,
): Promise<DmDeliveryResult> {
  const user = await options.client.users.fetch(discordUserId);

  if (!isSendableUser(user)) {
    throw new HttpError(
      404,
      "user_not_found",
      "Discord user was not found or is not messageable by this bot.",
    );
  }

  const message = await user.send(resolveV2MessageIcons(messageOptions, options.client));

  return {
    discordUserId,
    messageId: message.id,
  };
}

function isSendableUser(value: unknown): value is SendableUser {
  return isRecord(value) && typeof value.send === "function";
}
