import { handleAdminUiRequest } from "@fullparty/admin";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { handleAdminApiRequest } from "../admin/integration.js";
import { recordAdminBotEvent } from "../admin/telemetryRecorder.js";
import { reportError, runReportedTask } from "../health/errorReporter.js";
import { createHealthResponse } from "../health/healthService.js";
import { dispatchEvent } from "./eventDispatcher.js";
import {
  getAdminEventSubject,
  getEventDataType,
  getEventErrorCode,
  getRequestHost,
  getRequestId,
  recordWebhookFailure,
  writeEventConsoleLog,
  writeRejectedEventConsoleLog,
} from "./eventLogging.js";
import { integrationHealthcheckEvent, parseEvent } from "./eventSchemas.js";
import { handleHealthcheckRequest } from "./healthcheck.js";
import { assertJsonContentType, parseJsonBody, readRawBody } from "./requestBody.js";
import { handleError, sendJson } from "./response.js";
import type { WebhookServerOptions } from "./types.js";
import { verifyWebhookSignature } from "./webhookSignature.js";

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
    void runReportedTask(
      options.context,
      { source: "webhook", action: "http_response" },
      () => handleRequest(request, response, options),
    );
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
  let url = new URL("http://localhost");
  let eventLogWritten = false;
  let eventName: string | undefined;

  try {
    url = new URL(request.url ?? "/", "http://localhost");
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

    if (url.pathname !== "/events") {
      reportError(options.context, error, {
        source: url.pathname.startsWith("/admin") ? "admin_api" : "webhook",
        action: "http_request",
      });
    }
    handleError(response, error, options);
  }
}

function formatAddress(address: AddressInfo | null): string {
  if (!address) {
    return "unknown";
  }

  return `${address.address}:${String(address.port)}`;
}
