import { formatDiscordDateTime } from "../../lib/discordTimestamps.js";
import type { NotificationDeliveryData } from "../types.js";
import {
  getDisplayStringValue,
  getPayloadStringValue,
  getRecordStringValue,
  getRecordValue,
} from "./values.js";

type PartyFinderDetails = {
  character?: string;
  password?: string;
  publishedAt?: string;
  status?: string;
  world?: string;
};

export function getPartyFinderDetails(
  data: NotificationDeliveryData,
): PartyFinderDetails {
  const partyFinder = getRecordValue(data.notification.payload, "party_finder");
  const details: PartyFinderDetails = {};
  const character =
    getDisplayStringValue(data.notification.params.character) ??
    getRecordStringValue(partyFinder, "character_name");
  const password =
    getDisplayStringValue(data.notification.params.password) ??
    getRecordStringValue(partyFinder, "password");
  const publishedAt = formatDiscordDateTime(
    getRecordStringValue(partyFinder, "published_at"),
  );
  const status = getPayloadStringValue(data.notification.payload, "status");
  const world =
    getDisplayStringValue(data.notification.params.world) ??
    getRecordStringValue(partyFinder, "world");

  if (character) {
    details.character = character;
  }

  if (password) {
    details.password = password;
  }

  if (publishedAt) {
    details.publishedAt = publishedAt;
  }

  if (status) {
    details.status = status;
  }

  if (world) {
    details.world = world;
  }

  return details;
}
