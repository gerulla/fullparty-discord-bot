import type { NotificationCopy, NotificationDeliveryData } from "../types.js";
import {
  addStartsAtField,
  getDisplayStringValue,
  getNotificationStartsAt,
  getNumberValue,
  getPayloadDisplayStringValue,
  getPayloadStringValue,
  joinDescriptionParts,
} from "./values.js";

export type ApplicationDetails = {
  activity?: string;
  character?: string;
  count?: number;
  group?: string;
  reason?: string;
  startsAt?: string;
  status?: string;
};

export function formatApplicationNotification(
  data: NotificationDeliveryData,
  copy: NotificationCopy,
  subject: string,
  title: string,
  fields: ApplicationFieldKey[],
): NotificationCopy {
  const details = getApplicationDetails(data);

  if (!hasApplicationDetails(details)) {
    return copy;
  }

  return {
    ...copy,
    description: joinDescriptionParts(
      buildApplicationSummary(subject, details),
      buildApplicationFields(details, addStartsAtField(details, fields)),
    ),
    title,
  };
}

function getApplicationDetails(data: NotificationDeliveryData): ApplicationDetails {
  const details: ApplicationDetails = {};
  const activity =
    getDisplayStringValue(data.notification.params.activity) ??
    getPayloadDisplayStringValue(data.notification.payload, "activity_title");
  const character =
    getDisplayStringValue(data.notification.params.character) ??
    getPayloadDisplayStringValue(data.notification.payload, "character_name");
  const count = getNumberValue(data.notification.params.count);
  const group =
    getDisplayStringValue(data.notification.params.group) ??
    getPayloadDisplayStringValue(data.notification.payload, "group_slug");
  const reason =
    getDisplayStringValue(data.notification.params.reason) ??
    getPayloadDisplayStringValue(data.notification.payload, "review_reason");
  const status = getPayloadStringValue(data.notification.payload, "status");
  const startsAt = getNotificationStartsAt(data);

  if (activity) {
    details.activity = activity;
  }

  if (character) {
    details.character = character;
  }

  if (count !== undefined) {
    details.count = count;
  }

  if (group) {
    details.group = group;
  }

  if (reason) {
    details.reason = reason;
  }

  if (status) {
    details.status = status;
  }

  if (startsAt) {
    details.startsAt = startsAt;
  }

  return details;
}

function hasApplicationDetails(details: ApplicationDetails): boolean {
  return Boolean(
    details.activity ??
    details.character ??
    (details.count !== undefined ? "count" : undefined) ??
    details.group ??
    details.reason ??
    details.startsAt ??
    details.status,
  );
}

function buildApplicationSummary(subject: string, details: ApplicationDetails): string {
  const activity = details.activity ? ` for ${details.activity}` : "";
  const group = details.group ? ` in ${details.group}` : "";

  return `${subject}${activity}${group}.`;
}

function buildApplicationFields(
  details: ApplicationDetails,
  fields: ApplicationFieldKey[],
): string | undefined {
  const lines = fields.flatMap((field) => {
    const value = details[field];

    if (value === undefined) {
      return [];
    }

    return [`${applicationFieldLabels[field]}: ${String(value)}`];
  });

  return lines.length > 0 ? lines.join("\n") : undefined;
}

export type ApplicationFieldKey =
  | "character"
  | "count"
  | "reason"
  | "startsAt"
  | "status";

const applicationFieldLabels: Record<ApplicationFieldKey, string> = {
  character: "Character",
  count: "Applications waiting",
  reason: "Reason",
  startsAt: "Scheduled start",
  status: "Status",
};
