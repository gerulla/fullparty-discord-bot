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

export function createGuildUpcomingRunsMessage(
  response: unknown,
  fullpartyWebBaseUrl: string,
): InteractionEditReplyOptions {
  const runs = extractCollection(response, ["upcoming_runs", "runs", "items", "data"]);

  if (runs.length === 0) {
    return {
      content: "No upcoming FullParty runs were found for this Discord server.",
    };
  }

  const visibleRuns = runs.slice(0, maxEmbedsPerMessage);
  const truncation =
    runs.length > maxEmbedsPerMessage
      ? ` Showing first ${String(visibleRuns.length)}.`
      : "";

  return {
    content: `Found ${String(runs.length)} upcoming FullParty ${runs.length === 1 ? "run" : "runs"} for this server.${truncation}`,
    embeds: visibleRuns.map((run) => createGuildRunEmbed(run, fullpartyWebBaseUrl)),
  };
}

function createGuildRunEmbed(
  run: Record<string, unknown>,
  fullpartyWebBaseUrl: string,
): APIEmbed {
  const activity = getActivityTitle(run) ?? "Upcoming FullParty run";
  const group = getGroupDisplayName(run);
  const status = getStringValueFromKeys(run, ["status"]);
  const description = group ? `${activity} in ${group}.` : activity;
  const embed: APIEmbed = {
    color: 0x8b5cf6,
    description: truncateForDiscord(description, embedDescriptionLimit),
    fields: createFields([
      ["Run ID", getRunId(run)],
      ["Starts", formatDiscordDateTime(getStartsAt(run))],
      ["Duration", getDuration(run)],
      ["Status", status ? humanizeIdentifier(status) : undefined],
      ["Group", group],
      ["Datacenter", getDatacenter(run)],
      ["Style", humanizeOptionalIdentifier(getRunStyle(run))],
      ["Intensity", humanizeOptionalIdentifier(getIntensity(run))],
      ["Applications", getNeedsApplication(run)],
      ["Target Prog", humanizeOptionalIdentifier(getTargetProgPoint(run))],
    ]),
    footer: {
      text: "FullParty - Guild Runs",
    },
    title: truncateForDiscord(activity, embedTitleLimit),
  };
  const actionUrl = getActionUrl(run, fullpartyWebBaseUrl);

  if (actionUrl) {
    embed.url = actionUrl;
  }

  return embed;
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

function getRunId(value: Record<string, unknown>): string | undefined {
  const runId = value.run_id ?? value.id ?? value.activity_id;

  return typeof runId === "number" || typeof runId === "string"
    ? String(runId)
    : undefined;
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
    getActivityTypeName(value)
  );
}

function getGroupDisplayName(value: Record<string, unknown>): string | undefined {
  return (
    getStringValueFromKeys(value, ["group_name", "group", "group_slug"]) ??
    getNestedStringValue(value.group, ["name", "title", "slug"])
  );
}

function getStartsAt(value: Record<string, unknown>): string | undefined {
  return (
    getStringValueFromKeys(value, ["starts_at", "start_at"]) ??
    getNestedStringValue(value.activity, ["starts_at", "start_at"])
  );
}

function getDatacenter(value: Record<string, unknown>): string | undefined {
  return (
    getStringValueFromKeys(value, ["datacenter"]) ??
    getNestedStringValue(value.activity, ["datacenter"])
  );
}

function getDuration(value: Record<string, unknown>): string | undefined {
  const durationHours = value.duration_hours;

  if (typeof durationHours !== "number") {
    return undefined;
  }

  return `${String(durationHours)}h`;
}

function getRunStyle(value: Record<string, unknown>): string | undefined {
  return getStringValueFromKeys(value, ["run_style"]);
}

function getIntensity(value: Record<string, unknown>): string | undefined {
  return getStringValueFromKeys(value, ["intensity"]);
}

function getNeedsApplication(value: Record<string, unknown>): string | undefined {
  if (typeof value.needs_application !== "boolean") {
    return undefined;
  }

  return value.needs_application ? "Required" : "Not required";
}

function getTargetProgPoint(value: Record<string, unknown>): string | undefined {
  return getStringValueFromKeys(value, ["target_prog_point_key"]);
}

function humanizeOptionalIdentifier(value: string | undefined): string | undefined {
  return value ? humanizeIdentifier(value) : undefined;
}

function getActivityTypeName(value: Record<string, unknown>): string | undefined {
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
