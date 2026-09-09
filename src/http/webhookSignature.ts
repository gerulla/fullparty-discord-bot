import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { HttpError } from "./httpError.js";

export function verifyWebhookSignature(
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

export function getSingleHeader(
  request: IncomingMessage,
  header: string,
): string | undefined {
  const value = request.headers[header];

  if (Array.isArray(value)) {
    return value.at(0);
  }

  return value;
}
