import { formatDiscordDateTime } from "../../lib/discordTimestamps.js";
import type { NotificationDeliveryData } from "../types.js";
import {
  getDisplayStringValue,
  getNotificationStartsAt,
  getPayloadDisplayStringValue,
  getPayloadStringValue,
  getRecordStringValue,
  getRecordValue,
  isString,
} from "./values.js";

type PartyFinderDetails = {
  activity?: string;
  character?: string;
  group?: string;
  password?: string;
  publishedAt?: string;
  startsAt?: string;
  status?: string;
  world?: string;
};

export function getPartyFinderDetails(
  data: NotificationDeliveryData,
): PartyFinderDetails {
  const partyFinder = getRecordValue(data.notification.payload, "party_finder");
  const details: PartyFinderDetails = {};
  const activity =
    getDisplayStringValue(data.notification.params.activity) ??
    getPayloadDisplayStringValue(data.notification.payload, "activity_title");
  const character =
    getDisplayStringValue(data.notification.params.character) ??
    getRecordStringValue(partyFinder, "character_name");
  const group =
    getDisplayStringValue(data.notification.params.group) ??
    getPayloadDisplayStringValue(data.notification.payload, "group_slug");
  const password =
    getDisplayStringValue(data.notification.params.password) ??
    getRecordStringValue(partyFinder, "password");
  const publishedAt = formatDiscordDateTime(
    getRecordStringValue(partyFinder, "published_at"),
  );
  const startsAt = getNotificationStartsAt(data);
  const status = getPayloadStringValue(data.notification.payload, "status");
  const world =
    getDisplayStringValue(data.notification.params.world) ??
    getRecordStringValue(partyFinder, "world");

  if (activity) {
    details.activity = activity;
  }

  if (character) {
    details.character = character;
  }

  if (group) {
    details.group = group;
  }

  if (password) {
    details.password = password;
  }

  if (publishedAt) {
    details.publishedAt = publishedAt;
  }

  if (startsAt) {
    details.startsAt = startsAt;
  }

  if (status) {
    details.status = status;
  }

  if (world) {
    details.world = world;
  }

  return details;
}

export function hasPartyFinderDetails(details: PartyFinderDetails): boolean {
  return Boolean(
    details.activity ??
    details.character ??
    details.group ??
    details.password ??
    details.publishedAt ??
    details.startsAt ??
    details.status ??
    details.world,
  );
}

export function buildPartyFinderSummary(details: PartyFinderDetails): string {
  const activity = details.activity ?? "Your run";
  const group = details.group ? ` in ${details.group}` : "";

  return `Party Finder was posted for ${activity}${group}.`;
}

export function buildPartyFinderFields(details: PartyFinderDetails): string | undefined {
  const lines = [
    details.startsAt ? `Scheduled start: ${details.startsAt}` : undefined,
    details.character ? `Character: ${details.character}` : undefined,
    details.world ? `World: ${details.world}` : undefined,
    details.password ? `Password: ${formatInlineCode(details.password)}` : undefined,
    details.publishedAt ? `Posted at: ${details.publishedAt}` : undefined,
    details.status ? `Status: ${details.status}` : undefined,
  ].filter(isString);

  return lines.length > 0 ? lines.join("\n") : undefined;
}

function formatInlineCode(value: string): string {
  return `\`${value.replaceAll("`", "'")}\``;
}
