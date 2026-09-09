import type { NotificationDeliveryData } from "../types.js";
import { getAssignmentExtraFields } from "./roster.js";
import {
  getDisplayStringValue,
  getNotificationStartsAt,
  getPayloadDisplayStringValue,
  getPayloadStringValue,
  getStringValue,
} from "./values.js";

type AssignmentDetails = {
  activity?: string;
  attendanceStatus?: string;
  character?: string;
  extraFields: AssignmentDetailField[];
  group?: string;
  slot?: string;
  startsAt?: string;
};

export type AssignmentDetailField = {
  label: string;
  value: string;
};

export function getAssignmentDetails(data: NotificationDeliveryData): AssignmentDetails {
  const slot = getSlotDisplayName(data);
  const details: AssignmentDetails = {
    extraFields: getAssignmentExtraFields(data),
  };
  const activity =
    getDisplayStringValue(data.notification.params.activity) ??
    getPayloadDisplayStringValue(data.notification.payload, "activity_title");
  const character =
    getDisplayStringValue(data.notification.params.character) ??
    getPayloadDisplayStringValue(data.notification.payload, "character_name");
  const group =
    getDisplayStringValue(data.notification.params.group) ??
    getPayloadDisplayStringValue(data.notification.payload, "group_slug");
  const attendanceStatus =
    getStringValue(data.notification.params.attendance_status) ??
    getPayloadStringValue(data.notification.payload, "attendance_status");
  const startsAt = getNotificationStartsAt(data);

  if (activity) {
    details.activity = activity;
  }

  if (attendanceStatus) {
    details.attendanceStatus = attendanceStatus;
  }

  if (character) {
    details.character = character;
  }

  if (group) {
    details.group = group;
  }

  if (slot) {
    details.slot = slot;
  }

  if (startsAt) {
    details.startsAt = startsAt;
  }

  return details;
}

export function hasAssignmentDetails(details: AssignmentDetails): boolean {
  return Boolean(
    details.activity ??
    details.attendanceStatus ??
    details.character ??
    (details.extraFields.length > 0 ? "extra_fields" : undefined) ??
    details.group ??
    details.slot ??
    details.startsAt,
  );
}

function getSlotDisplayName(data: NotificationDeliveryData): string | undefined {
  const slotGroup =
    getDisplayStringValue(data.notification.params.slot_group) ??
    getPayloadDisplayStringValue(data.notification.payload, "slot_group");
  const slot =
    getDisplayStringValue(data.notification.params.slot) ??
    getPayloadDisplayStringValue(data.notification.payload, "slot_label") ??
    getPayloadStringValue(data.notification.payload, "slot_key");

  return slotGroup ?? slot;
}

export function getDesignationDisplayName(
  data: NotificationDeliveryData,
): string | undefined {
  return (
    getDisplayStringValue(data.notification.params.designation) ??
    getPayloadDisplayStringValue(data.notification.payload, "designation_label") ??
    getPayloadStringValue(data.notification.payload, "designation_key")
  );
}

export function buildAssignmentSummary(
  subject: string,
  details: AssignmentDetails,
  action?: string,
): string {
  const activity = details.activity ? ` for ${details.activity}` : "";
  const group = details.group ? ` in ${details.group}` : "";
  const actionText = action ? ` ${action}` : "";

  return `${subject}${activity}${group}${actionText}.`;
}

export function buildAssignmentFields(
  details: AssignmentDetails,
  fields: AssignmentFieldKey[],
): string | undefined {
  const lines = fields
    .flatMap((field) => {
      if (field === "extraFields") {
        return details.extraFields.map(
          (extraField) => `${extraField.label}: ${extraField.value}`,
        );
      }

      const value = details[field];

      return value ? [`${assignmentFieldLabels[field]}: ${value}`] : [];
    })
    .filter(Boolean);

  return lines.length > 0 ? lines.join("\n") : undefined;
}

type AssignmentFieldKey =
  | "attendanceStatus"
  | "character"
  | "extraFields"
  | "slot"
  | "startsAt";

const assignmentFieldLabels: Record<
  Exclude<AssignmentFieldKey, "extraFields">,
  string
> = {
  attendanceStatus: "Attendance",
  character: "Character",
  slot: "Slot",
  startsAt: "Scheduled start",
};
