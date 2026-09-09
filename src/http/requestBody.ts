import type { IncomingMessage } from "node:http";
import { HttpError } from "./httpError.js";

export function assertJsonContentType(request: IncomingMessage): void {
  const contentType = request.headers["content-type"] ?? "";

  if (!contentType.includes("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "Expected application/json.");
  }
}

export async function readRawBody(
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

export function parseJsonBody(rawBody: Buffer): unknown {
  try {
    return JSON.parse(rawBody.toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
}
