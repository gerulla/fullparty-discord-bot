import type { APIEmbed, APIEmbedField, InteractionEditReplyOptions } from "discord.js";

import { formatDiscordDateTime } from "../lib/discordTimestamps.js";
import {
  humanizeIdentifier,
  resolveFullpartyActionUrl,
  truncateForDiscord,
} from "../notifications/notificationText.js";

const embedDescriptionLimit = 4096;
const embedFieldValueLimit = 1024;
const embedTitleLimit = 256;
const maxEmbedsPerMessage = 10;

const applicationStatusColors: Record<string, number> = {
  approved: 0x22c55e,
  cancelled: 0x6b7280,
  declined: 0xd83c3e,
  pending: 0x3b82f6,
  withdrawn: 0x6b7280,
};

export function createApplicationsMessage(
  response: unknown,
  fullpartyWebBaseUrl: string,
): InteractionEditReplyOptions {
  const applications = extractCollection(response, ["applications", "items", "data"]);

  if (applications.length === 0) {
    return {
      content: "No FullParty applications were found for your Discord account.",
    };
  }

  const visibleApplications = applications.slice(0, maxEmbedsPerMessage);

  return {
    content: createResultSummary("application", applications.length),
    embeds: visibleApplications.map((application) =>
      createApplicationEmbed(application, fullpartyWebBaseUrl),
    ),
  };
}

export function createUpcomingRunsMessage(
  response: unknown,
  fullpartyWebBaseUrl: string,
): InteractionEditReplyOptions {
  const runs = extractCollection(response, [
    "upcoming_runs",
    "upcomingRuns",
    "runs",
    "items",
    "data",
  ]);

  if (runs.length === 0) {
    return {
      content: "No upcoming FullParty runs were found for your Discord account.",
    };
  }

  const visibleRuns = runs.slice(0, maxEmbedsPerMessage);

  return {
    content: createResultSummary("upcoming run", runs.length),
    embeds: visibleRuns.map((run) => createRunEmbed(run, fullpartyWebBaseUrl)),
  };
}

function createApplicationEmbed(
  application: Record<string, unknown>,
  fullpartyWebBaseUrl: string,
): APIEmbed {
  const activity = getActivityTitle(application) ?? "FullParty application";
  const group = getGroupDisplayName(application);
  const status = getStringValueFromKeys(application, ["status"]);
  const reason = getStringValueFromKeys(application, [
    "review_reason",
    "reason",
    "decline_reason",
  ]);
  const description = group
    ? `Application for ${activity} in ${group}.`
    : `Application for ${activity}.`;
  const embed: APIEmbed = {
    color: getStatusColor(status, 0x3b82f6),
    description: truncateForDiscord(description, embedDescriptionLimit),
    fields: createFields([
      ["Character", getCharacterFieldValue(application)],
      ["Status", status ? humanizeIdentifier(status) : undefined],
      ["Starts", formatDiscordDateTime(getStartsAt(application))],
      ["Submitted", formatDiscordDateTime(getSubmittedAt(application))],
      ["Datacenter", getDatacenter(application)],
      ["Style", humanizeOptionalIdentifier(getRunStyle(application))],
      ["Intensity", humanizeOptionalIdentifier(getIntensity(application))],
      ["Reason", reason],
    ]),
    footer: {
      text: "FullParty - Applications",
    },
    title: truncateForDiscord(activity, embedTitleLimit),
  };
  const actionUrl = getActionUrl(application, fullpartyWebBaseUrl);

  if (actionUrl) {
    embed.url = actionUrl;
  }

  return embed;
}

function createRunEmbed(
  run: Record<string, unknown>,
  fullpartyWebBaseUrl: string,
): APIEmbed {
  const activity = getActivityTitle(run) ?? "Upcoming FullParty run";
  const group = getGroupDisplayName(run);
  const status = getStringValueFromKeys(run, ["status"]);
  const description = group ? `${activity} in ${group}.` : activity;
  const embed: APIEmbed = {
    color: 0xf59e0b,
    description: truncateForDiscord(description, embedDescriptionLimit),
    fields: createFields([
      ["Starts", formatDiscordDateTime(getStartsAt(run))],
      ["Status", status ? humanizeIdentifier(status) : undefined],
      ["Character", getCharacterFieldValue(run)],
      ["Party", getPartyDisplayName(run)],
      ["Datacenter", getDatacenter(run)],
      ["Style", humanizeOptionalIdentifier(getRunStyle(run))],
      ["Intensity", humanizeOptionalIdentifier(getIntensity(run))],
    ]),
    footer: {
      text: "FullParty - Upcoming Runs",
    },
    title: truncateForDiscord(activity, embedTitleLimit),
  };
  const actionUrl = getActionUrl(run, fullpartyWebBaseUrl);

  if (actionUrl) {
    embed.url = actionUrl;
  }

  return embed;
}

function createResultSummary(label: string, total: number): string {
  const pluralLabel = total === 1 ? label : `${label}s`;
  const visibleCount = Math.min(total, maxEmbedsPerMessage);
  const truncation =
    total > maxEmbedsPerMessage ? ` Showing first ${String(visibleCount)}.` : "";

  return `Found ${String(total)} FullParty ${pluralLabel}.${truncation}`;
}

function extractCollection(
  value: unknown,
  candidateKeys: string[],
): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }

  if (!isRecord(value)) {
    return [];
  }

  for (const key of candidateKeys) {
    const collection = getNestedCollection(value[key], candidateKeys);

    if (collection.length > 0) {
      return collection;
    }
  }

  return [];
}

function getNestedCollection(
  value: unknown,
  candidateKeys: string[],
): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }

  if (!isRecord(value)) {
    return [];
  }

  for (const key of candidateKeys) {
    const nestedValue = value[key];

    if (Array.isArray(nestedValue)) {
      return nestedValue.filter(isRecord);
    }
  }

  return [];
}

function createFields(fields: [string, string | undefined][]): APIEmbedField[] {
  return fields.flatMap(([name, value]) => {
    if (!value) {
      return [];
    }

    return [
      {
        inline: true,
        name,
        value: truncateForDiscord(value, embedFieldValueLimit),
      },
    ];
  });
}

function getActivityTitle(value: Record<string, unknown>): string | undefined {
  return (
    getStringValueFromKeys(value, [
      "activity_title",
      "display_name",
      "title",
      "name",
      "activity",
    ]) ??
    getNestedStringValue(value.activity, ["display_name", "title", "name"]) ??
    getActivityTypeName(value) ??
    getActivityTypeName(getRecordValue(value, "activity"))
  );
}

function getCharacterDisplayName(value: Record<string, unknown>): string | undefined {
  const character = getCharacterRecord(value);

  return (
    getStringValueFromKeys(value, ["character_name", "character"]) ??
    getNestedStringValue(character, ["name", "display_name"])
  );
}

function getGroupDisplayName(value: Record<string, unknown>): string | undefined {
  return (
    getStringValueFromKeys(value, ["group_name", "group", "group_slug"]) ??
    getNestedStringValue(value.group, ["name", "title", "slug"]) ??
    getNestedStringValue(getRecordValue(value.activity, "group"), [
      "name",
      "title",
      "slug",
    ])
  );
}

function getCharacterFieldValue(value: Record<string, unknown>): string | undefined {
  const characterName = getCharacterDisplayName(value);
  const character = getCharacterRecord(value);
  const world = getNestedStringValue(character, ["world"]);
  const datacenter = getNestedStringValue(character, ["datacenter"]);
  const location = [world, datacenter].filter(Boolean).join(", ");

  if (!characterName) {
    return location || undefined;
  }

  return location ? `${characterName} (${location})` : characterName;
}

function getCharacterRecord(
  value: Record<string, unknown>,
): Record<string, unknown> | undefined {
  return (
    getRecordValue(value, "character") ??
    getRecordValue(
      getRecordValue(getRecordValue(value, "user_context"), "slot"),
      "character",
    ) ??
    getRecordValue(getRecordValue(value, "organizer"), "character")
  );
}

function getPartyDisplayName(value: Record<string, unknown>): string | undefined {
  const slot = getRecordValue(getRecordValue(value, "user_context"), "slot");

  return (
    getStringValueFromKeys(value, ["slot_group", "party", "roster_group"]) ??
    getLocalizedLabel(getRecordUnknownValue(slot, "group_label")) ??
    getNestedStringValue(slot, ["group_key"]) ??
    getLocalizedLabel(getRecordUnknownValue(value.roster, "group_label")) ??
    getNestedStringValue(value.roster, ["group_key"])
  );
}

function getStartsAt(value: Record<string, unknown>): string | undefined {
  return (
    getStringValueFromKeys(value, ["starts_at", "start_at"]) ??
    getNestedStringValue(value.activity, ["starts_at", "start_at"])
  );
}

function getSubmittedAt(value: Record<string, unknown>): string | undefined {
  return getStringValueFromKeys(value, ["submitted_at"]);
}

function getDatacenter(value: Record<string, unknown>): string | undefined {
  return (
    getStringValueFromKeys(value, ["datacenter"]) ??
    getNestedStringValue(value.activity, ["datacenter"])
  );
}

function getRunStyle(value: Record<string, unknown>): string | undefined {
  return (
    getStringValueFromKeys(value, ["run_style"]) ??
    getNestedStringValue(value.activity, ["run_style"])
  );
}

function getIntensity(value: Record<string, unknown>): string | undefined {
  return (
    getStringValueFromKeys(value, ["intensity"]) ??
    getNestedStringValue(value.activity, ["intensity"])
  );
}

function getActivityTypeName(
  value: Record<string, unknown> | undefined,
): string | undefined {
  return getLocalizedLabel(
    getRecordUnknownValue(getRecordValue(value, "activity_type"), "name"),
  );
}

function getActionUrl(
  value: Record<string, unknown>,
  fullpartyWebBaseUrl: string,
): string | undefined {
  const actionUrl =
    getStringValueFromKeys(value, ["action_url", "url", "link"]) ??
    getNestedStringValue(value.urls, ["overview"]);

  return actionUrl
    ? resolveFullpartyActionUrl(actionUrl, fullpartyWebBaseUrl)
    : undefined;
}

function getStringValueFromKeys(
  value: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const stringValue = getDisplayStringValue(value[key]);

    if (stringValue) {
      return stringValue;
    }
  }

  return undefined;
}

function getNestedStringValue(value: unknown, keys: string[]): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return getStringValueFromKeys(value, keys);
}

function getRecordValue(
  value: unknown,
  key: string,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const nestedValue = value[key];

  return isRecord(nestedValue) ? nestedValue : undefined;
}

function getRecordUnknownValue(value: unknown, key: string): unknown {
  if (!isRecord(value)) {
    return undefined;
  }

  return value[key];
}

function getLocalizedLabel(value: unknown): string | undefined {
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

function humanizeOptionalIdentifier(value: string | undefined): string | undefined {
  return value ? humanizeIdentifier(value) : undefined;
}

function getStatusColor(status: string | undefined, fallback: number): number {
  if (!status) {
    return fallback;
  }

  return applicationStatusColors[status.toLowerCase()] ?? fallback;
}

function getDisplayStringValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();

  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
