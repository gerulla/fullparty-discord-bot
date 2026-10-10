import type { NotificationDeliveryData } from "../types.js";
import {
  getDisplayStringValue,
  getPayloadDisplayStringValue,
  getPayloadStringValue,
} from "./values.js";

export type AssignmentDetailField = {
  label: string;
  value: string;
};

export function getDesignationDisplayName(
  data: NotificationDeliveryData,
): string | undefined {
  return (
    getPayloadDisplayStringValue(data.notification.payload, "designation_label") ??
    getDisplayStringValue(data.notification.params.designation) ??
    getPayloadStringValue(data.notification.payload, "designation_key")
  );
}
