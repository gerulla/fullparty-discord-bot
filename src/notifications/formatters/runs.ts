import type { NotificationDeliveryData } from "../types.js";
import type { RunCompletionDetails } from "./completion.js";
import { buildRunCompletionFields, getRunCompletionDetails } from "./completion.js";
import {
  getDisplayStringValue,
  getNotificationStartsAt,
  getPayloadDisplayStringValue,
  getPayloadStringValue,
  isString,
} from "./values.js";

type RunDetails = {
  activity?: string;
  completion?: RunCompletionDetails;
  group?: string;
  startsAt?: string;
  status?: string;
};

export function getRunDetails(data: NotificationDeliveryData): RunDetails {
  const details: RunDetails = {};
  const activity =
    getDisplayStringValue(data.notification.params.activity) ??
    getPayloadDisplayStringValue(data.notification.payload, "activity_title");
  const group =
    getDisplayStringValue(data.notification.params.group) ??
    getPayloadDisplayStringValue(data.notification.payload, "group_slug");
  const startsAt = getNotificationStartsAt(data);
  const status = getPayloadStringValue(data.notification.payload, "status");
  const completion = getRunCompletionDetails(data.notification.payload);

  if (activity) {
    details.activity = activity;
  }

  if (group) {
    details.group = group;
  }

  if (startsAt) {
    details.startsAt = startsAt;
  }

  if (status) {
    details.status = status;
  }

  if (completion) {
    details.completion = completion;
  }

  return details;
}

export function hasRunDetails(details: RunDetails): boolean {
  return Boolean(
    details.activity ??
    details.group ??
    details.startsAt ??
    details.status ??
    (details.completion ? "completion" : undefined),
  );
}

export function buildRunSummary(details: RunDetails, action: string): string {
  const activity = details.activity ?? "A run";
  const group = details.group ? ` in ${details.group}` : "";

  return `${activity}${group} ${action}.`;
}

export function buildRunFields(details: RunDetails): string | undefined {
  const lines = [
    details.startsAt ? `Scheduled start: ${details.startsAt}` : undefined,
    details.status ? `Status: ${details.status}` : undefined,
    ...buildRunCompletionFields(details.completion),
  ].filter(isString);

  return lines.length > 0 ? lines.join("\n") : undefined;
}
