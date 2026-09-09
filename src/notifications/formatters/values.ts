import { formatDiscordDateTime } from "../../lib/discordTimestamps.js";
import { humanizeIdentifier } from "../notificationText.js";
import type { NotificationDeliveryData } from "../types.js";
import type { ApplicationDetails, ApplicationFieldKey } from "./applications.js";

export function addStartsAtField(
  details: ApplicationDetails,
  fields: ApplicationFieldKey[],
): ApplicationFieldKey[] {
  return details.startsAt && !fields.includes("startsAt")
    ? ["startsAt", ...fields]
    : fields;
}

export function joinDescriptionParts(
  summary: string,
  details: string | undefined,
): string {
  return details ? `${summary}\n\n${details}` : summary;
}

export function getPayloadDisplayStringValue(
  payload: unknown,
  key: string,
): string | undefined {
  if (typeof payload !== "object" || payload === null || !(key in payload)) {
    return undefined;
  }

  return getDisplayStringValue((payload as Record<string, unknown>)[key]);
}

export function getNotificationStartsAt(
  data: NotificationDeliveryData,
): string | undefined {
  return formatDiscordDateTime(
    getDisplayStringValue(data.notification.params.starts_at) ??
      getDisplayStringValue(data.notification.params.start_at) ??
      getPayloadRawStringValue(data.notification.payload, "starts_at") ??
      getPayloadRawStringValue(data.notification.payload, "start_at") ??
      getNestedPayloadRawStringValue(data.notification.payload, "run", "starts_at") ??
      getNestedPayloadRawStringValue(data.notification.payload, "run", "start_at") ??
      getNestedPayloadRawStringValue(
        data.notification.payload,
        "activity",
        "starts_at",
      ) ??
      getNestedPayloadRawStringValue(data.notification.payload, "activity", "start_at"),
  );
}

function getNestedPayloadRawStringValue(
  payload: unknown,
  nestedKey: string,
  key: string,
): string | undefined {
  return getRecordStringValue(getRecordValue(payload, nestedKey), key);
}

export function getPayloadStringValue(payload: unknown, key: string): string | undefined {
  if (typeof payload !== "object" || payload === null || !(key in payload)) {
    return undefined;
  }

  return getStringValue((payload as Record<string, unknown>)[key]);
}

function getPayloadRawStringValue(payload: unknown, key: string): string | undefined {
  if (typeof payload !== "object" || payload === null || !(key in payload)) {
    return undefined;
  }

  return getDisplayStringValue((payload as Record<string, unknown>)[key]);
}

export function getRecordUnknownValue(value: unknown, key: string): unknown {
  if (!isRecord(value)) {
    return undefined;
  }

  return value[key];
}

export function getRecordValue(
  value: unknown,
  key: string,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const nestedValue = value[key];

  return isRecord(nestedValue) ? nestedValue : undefined;
}

export function getRecordStringValue(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return getDisplayStringValue(value[key]);
}

export function getRecordNumberValue(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const numberValue = value[key];

  return typeof numberValue === "number" && Number.isFinite(numberValue)
    ? numberValue
    : undefined;
}

export function getNumberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function getLocalizedLabel(value: unknown): string | undefined {
  if (typeof value === "string") {
    return getDisplayStringValue(value);
  }

  if (!isRecord(value)) {
    return undefined;
  }

  return getDisplayStringValue(value.en) ?? getFirstStringValue(value);
}

function getFirstStringValue(value: Record<string, unknown>): string | undefined {
  for (const nestedValue of Object.values(value)) {
    const stringValue = getDisplayStringValue(nestedValue);

    if (stringValue) {
      return stringValue;
    }
  }

  return undefined;
}

export function getDisplayStringValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();

  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

export function isString(value: string | undefined): value is string {
  return typeof value === "string";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function getStringValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    return undefined;
  }

  return humanizeIdentifier(trimmedValue);
}
