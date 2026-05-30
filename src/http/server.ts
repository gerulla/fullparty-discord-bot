import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createHmac, timingSafeEqual } from "node:crypto";

import { type Client, type MessageCreateOptions } from "discord.js";
import { z } from "zod";

import type { BotContext } from "../bot/context.js";
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

const userAppDisconnectedMessage = [
  "FullParty has disconnected Discord for your account.",
  "To fully remove the app from Discord, open Discord Settings > Authorized Apps and remove FullParty.",
].join("\n");

// TODO: Replace this with a polished onboarding message once the final integration
// feature set and support links are settled.
const userAppInstalledMessage = [
  "Welcome to FullParty. Your Discord account is now connected.",
  "This integration lets FullParty keep your Discord identity in sync with your account, unlock Discord-powered account features, and send you useful updates when something needs your attention.",
  "You can disconnect this anytime from your FullParty account settings.",
].join("\n\n");

const integrationHealthcheckEvent = "integration.healthcheck";

export type WebhookServerOptions = {
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

type SendableUser = {
  send(message: MessageCreateOptions): Promise<{ id: string }>;
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

  try {
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true, status: "healthy" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/events") {
      handleHealthcheckRequest(request, response, options);
      writeEventConsoleLog(request, url, integrationHealthcheckEvent);
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
    writeEventConsoleLog(request, url, event.event, getEventDataType(event));
    eventLogWritten = true;
    const result = await dispatchEvent(event, options);

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

async function dispatchEvent(
  event: FullpartyEvent,
  options: WebhookServerOptions,
): Promise<ActionResult> {
  if (event.event === "discord.user_app.installed") {
    const data = userAppEventDataSchema.parse(event.data);
    const discordUserId = data.discord_user.id;

    return sendUserDm(options, discordUserId, {
      content: data.welcome_message ?? userAppInstalledMessage,
    });
  }

  if (event.event === "discord.user_app.disconnected") {
    const data = userAppEventDataSchema.parse(event.data);
    const discordUserId = data.discord_user.id;

    return sendUserDm(options, discordUserId, {
      content: userAppDisconnectedMessage,
    });
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
    );

    return {
      ...result,
      category: data.category,
      notificationDeliveryId: data.notification_delivery_id,
      notificationEventId: data.notification_event_id,
      type: data.type,
    };
  }

  throw new HttpError(
    400,
    "unsupported_event",
    `Unsupported Fullparty event type: ${event.event}`,
  );
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

function getEventDataType(event: FullpartyEvent): string | undefined {
  if (!isRecord(event.data)) {
    return undefined;
  }

  const dataType = getStringProperty(event.data, "type");

  if (dataType) {
    return dataType;
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
