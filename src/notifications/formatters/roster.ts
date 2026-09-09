import { humanizeIdentifier } from "../notificationText.js";
import type { NotificationDeliveryData } from "../types.js";
import type { AssignmentDetailField } from "./assignments.js";
import {
  getDisplayStringValue,
  getLocalizedLabel,
  getRecordStringValue,
  getRecordUnknownValue,
  getRecordValue,
  isRecord,
} from "./values.js";

function getRoster(data: NotificationDeliveryData): Record<string, unknown> | undefined {
  return getRecordValue(data.notification.payload, "roster");
}

export function getAssignmentExtraFields(
  data: NotificationDeliveryData,
): AssignmentDetailField[] {
  const rosterFields = getRosterExtraFields(data);

  return rosterFields.length > 0 ? rosterFields : getFallbackExtraFields(data);
}

function getRosterExtraFields(data: NotificationDeliveryData): AssignmentDetailField[] {
  const fields = getRecordUnknownValue(getRoster(data), "fields");

  if (!Array.isArray(fields)) {
    return [];
  }

  const seenLabels = new Set<string>();
  const extraFields: AssignmentDetailField[] = [];

  for (const field of fields) {
    if (!isRecord(field)) {
      continue;
    }

    const label = getRosterFieldLabel(field);
    const value = getRosterFieldDisplayValue(field);

    if (!label || !value || seenLabels.has(label)) {
      continue;
    }

    seenLabels.add(label);
    extraFields.push({ label, value });
  }

  return extraFields;
}

function getRosterFieldLabel(field: Record<string, unknown>): string | undefined {
  const label = getLocalizedLabel(field.label);

  if (label) {
    return label;
  }

  const key = getRecordStringValue(field, "key");

  return key ? humanizeIdentifier(key) : undefined;
}

function getRosterFieldDisplayValue(field: Record<string, unknown>): string | undefined {
  const value = getRecordUnknownValue(field, "value");
  const meta = getRecordUnknownValue(field, "meta");

  return (
    getDisplayStringValue(field.display_value) ??
    getLocalizedLabel(getRecordUnknownValue(value, "label")) ??
    getRecordStringValue(value, "name") ??
    getRecordStringValue(value, "display_value") ??
    getRecordStringValue(value, "key") ??
    getLocalizedLabel(getRecordUnknownValue(meta, "label")) ??
    getRecordStringValue(meta, "name") ??
    getRecordStringValue(meta, "display_value") ??
    getRecordStringValue(meta, "key") ??
    getLocalizedLabel(value) ??
    getLocalizedLabel(meta)
  );
}

function getFallbackExtraFields(data: NotificationDeliveryData): AssignmentDetailField[] {
  const characterClass = formatClassDisplayName(
    getDisplayStringValue(data.notification.params.class),
    getDisplayStringValue(data.notification.params.class_shorthand),
  );
  const position = getDisplayStringValue(data.notification.params.position);
  const fields: AssignmentDetailField[] = [];

  if (characterClass) {
    fields.push({ label: "Class", value: characterClass });
  }

  if (position) {
    fields.push({ label: "Position", value: position });
  }

  return fields;
}

function formatClassDisplayName(
  className: string | undefined,
  classShorthand: string | undefined,
): string | undefined {
  if (!className) {
    return classShorthand;
  }

  if (!classShorthand || className.toLowerCase() === classShorthand.toLowerCase()) {
    return className;
  }

  return `${className} (${classShorthand})`;
}
