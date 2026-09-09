import type { NotificationDeliveryData } from "../types.js";
import {
  getDisplayStringValue,
  getPayloadStringValue,
  getStringValue,
} from "./values.js";

export function getSocialAccountProvider(
  data: NotificationDeliveryData,
): string | undefined {
  return (
    getStringValue(data.notification.params.provider) ??
    getPayloadStringValue(data.notification.payload, "provider")
  );
}

export function getCharacterDisplayName(
  data: NotificationDeliveryData,
): string | undefined {
  const character = getDisplayStringValue(data.notification.params.character);

  if (!character) {
    return undefined;
  }

  const world = getDisplayStringValue(data.notification.params.world);
  const datacenter = getDisplayStringValue(data.notification.params.datacenter);

  if (world && datacenter) {
    return `${character} (${world}, ${datacenter})`;
  }

  if (world) {
    return `${character} (${world})`;
  }

  return character;
}
