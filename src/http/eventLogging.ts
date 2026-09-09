import type { AdminBotEventInput } from "@fullparty/admin";
import type { IncomingMessage } from "node:http";
import { z } from "zod";
import { recordFailureSafely, serializeFailureError } from "../health/failureReporter.js";
import { getErrorMessage } from "../lib/errors.js";
import { getStringProperty, isRecord } from "../lib/valueReaders.js";
import type { FullpartyEvent } from "./eventSchemas.js";
import { HttpError } from "./httpError.js";
import type { WebhookServerOptions } from "./types.js";

export function writeEventConsoleLog(
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

export function writeRejectedEventConsoleLog(
  request: IncomingMessage,
  url: URL,
  error: unknown,
): void {
  process.stdout.write(
    `[FullParty Bot] Event rejected from ${getRequestHost(request)}: ${getEventErrorCode(error)} (${request.method ?? "UNKNOWN"} ${url.pathname}).\n`,
  );
}

export function recordWebhookFailure(
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

export function getAdminEventSubject(
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

export function getEventDataType(event: FullpartyEvent): string | undefined {
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

export function getEventErrorCode(error: unknown): string {
  if (error instanceof HttpError) {
    return error.code;
  }

  if (error instanceof z.ZodError) {
    return "invalid_payload";
  }

  return "internal_server_error";
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

export function getRequestId(event: FullpartyEvent): string | undefined {
  return event.requestId ?? event.request_id ?? event.id;
}

export function getRequestHost(request: IncomingMessage): string {
  return request.socket.remoteAddress ?? "unknown host";
}
