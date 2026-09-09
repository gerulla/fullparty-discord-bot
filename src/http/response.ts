import type { ServerResponse } from "node:http";
import { z } from "zod";
import { HttpError } from "./httpError.js";
import type { WebhookServerOptions } from "./types.js";

export function handleError(
  response: ServerResponse,
  error: unknown,
  options: WebhookServerOptions,
): void {
  if (response.destroyed || response.writableEnded) return;
  if (response.headersSent) {
    response.destroy();
    return;
  }
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

export function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  if (response.destroyed || response.writableEnded) return;
  const payload = JSON.stringify(body);

  response.writeHead(statusCode, {
    "content-length": Buffer.byteLength(payload),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(payload);
}
