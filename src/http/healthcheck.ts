import type { IncomingMessage, ServerResponse } from "node:http";
import { integrationHealthcheckEvent } from "./eventSchemas.js";
import { HttpError } from "./httpError.js";
import { sendJson } from "./response.js";
import type { WebhookServerOptions } from "./types.js";
import { getSingleHeader, verifyWebhookSignature } from "./webhookSignature.js";

export function handleHealthcheckRequest(
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
