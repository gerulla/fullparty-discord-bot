import type { MessageCreateOptions } from "discord.js";

import { formatDiscordDateTime } from "../lib/discordTimestamps.js";
import {
  humanizeIdentifier,
  resolveFullpartyActionUrl,
  truncateForDiscord,
} from "../notifications/notificationText.js";

const discordMessageLimit = 2000;
const truncationBuffer = 160;

export function createGuildUpcomingRunsPostMessage(
  response: unknown,
  fullpartyWebBaseUrl: string,
): MessageCreateOptions {
  const runs = extractCollection(response, ["upcoming_runs", "runs", "items", "data"]);
  const group = getGroupInfo(response, runs, fullpartyWebBaseUrl);

  if (runs.length === 0) {
    return {
      allowedMentions: {
        parse: [],
      },
      content: group.name
        ? `No upcoming FullParty runs were found for **${group.name}** right now.`
        : "No upcoming FullParty runs were found right now.",
    };
  }

  const lines = [
    group.name
      ? `Here are the upcoming FullParty runs for **${group.name}**:`
      : "Here are the upcoming FullParty runs:",
    "",
  ];
  let hiddenRunCount = 0;
  const hostMentionUserIds = new Set<string>();

  for (const [index, run] of runs.entries()) {
    const block = createRunBlock(run, fullpartyWebBaseUrl);
    const nextLines = [...lines, ...block.lines, ""];
    const footer = createFooter(group);

    if (
      nextLines.join("\n").length + footer.length + truncationBuffer >
      discordMessageLimit
    ) {
      hiddenRunCount = runs.length - index;
      break;
    }

    lines.push(...block.lines, "");

    if (block.hostDiscordUserId) {
      hostMentionUserIds.add(block.hostDiscordUserId);
    }
  }

  if (hiddenRunCount > 0) {
    lines.push(
      `...and ${String(hiddenRunCount)} more upcoming ${hiddenRunCount === 1 ? "run" : "runs"}.`,
      "",
    );
  }

  lines.push(createFooter(group));

  return {
    allowedMentions: {
      parse: [],
      users: [...hostMentionUserIds].slice(0, 100),
    },
    content: truncateForDiscord(lines.join("\n"), discordMessageLimit),
  };
}

function createRunBlock(
  run: Record<string, unknown>,
  fullpartyWebBaseUrl: string,
): {
  hostDiscordUserId?: string;
  lines: string[];
} {
  const title = getRunTitle(run) ?? "Upcoming FullParty run";
  const targetProgPoint = getTargetProgPoint(run);
  const titleWithProgPoint = targetProgPoint ? `${title} - ${targetProgPoint}` : title;
  const startsAt = formatDiscordDateTime(getStartsAt(run)) ?? "Time TBD";
  const applyUrl = getApplyUrl(run, fullpartyWebBaseUrl);
  const applyLine = applyUrl ? `[Apply Here](${applyUrl})` : "Apply on FullParty";
  const host = getHostLabel(run);

  return {
    ...(host?.discordUserId ? { hostDiscordUserId: host.discordUserId } : {}),
    lines: [
      `**${titleWithProgPoint}**`,
      `${formatParticipantCount(run)} - ${formatApplicationCount(run)} - ${startsAt}`,
      host ? `Hosted by ${host.label} - ${applyLine}` : applyLine,
    ],
  };
}

function createFooter(group: GuildPostGroupInfo): string {
  const scheduleLink = group.scheduleUrl
    ? `[Click Here](${group.scheduleUrl})`
    : "check FullParty";

  return group.name
    ? `-# For the full schedule of **${group.name}** ${scheduleLink}`
    : `-# For the full schedule ${scheduleLink}`;
}

function formatParticipantCount(run: Record<string, unknown>): string {
  const current =
    getNumberFromKeys(run, [
      "participant_count",
      "participants_count",
      "assigned_slots",
      "assigned_count",
      "filled_slots_count",
      "filled_count",
      "placed_count",
      "total_placed_count",
    ]) ?? getArrayCountFromKeys(run, ["participants", "discord_user_ids"]);
  const total = getNumberFromKeys(run, [
    "participant_capacity",
    "participants_capacity",
    "capacity",
    "max_participants",
    "slot_count",
    "slots_count",
    "total_slots",
    "total_slot_count",
    "roster_slots_count",
  ]);

  return `${formatOptionalCount(current)}/${formatOptionalCount(total)} Participants`;
}

function formatApplicationCount(run: Record<string, unknown>): string {
  const applications =
    getNumberFromKeys(run, [
      "applications_count",
      "application_count",
      "total_applicants",
      "pending_applications_count",
      "pending_application_count",
      "total_applications_count",
      "applications_pending_count",
    ]) ?? getArrayCountFromKeys(run, ["applications"]);

  return `${formatOptionalCount(applications)} Applications`;
}

function formatOptionalCount(value: number | undefined): string {
  return value === undefined ? "?" : String(value);
}

type GuildPostGroupInfo = {
  name?: string;
  scheduleUrl?: string;
};

function getGroupInfo(
  response: unknown,
  runs: Record<string, unknown>[],
  fullpartyWebBaseUrl: string,
): GuildPostGroupInfo {
  const meta = getRecordValue(response, "meta");
  const metaGroup = getRecordValue(meta, "group");
  const firstRunGroup = getRecordValue(runs.at(0), "group");
  const name =
    getStringValueFromKeys(metaGroup, ["name", "title", "slug"]) ??
    getStringValueFromKeys(firstRunGroup, ["name", "title", "slug"]) ??
    getStringValueFromKeys(meta, ["group_name", "group_slug"]);
  const slug =
    getStringValueFromKeys(metaGroup, ["slug"]) ??
    getStringValueFromKeys(firstRunGroup, ["slug"]) ??
    getStringValueFromKeys(meta, ["group_slug"]);
  const explicitScheduleUrl =
    getNestedStringValue(meta, "urls", ["schedule", "runs", "overview"]) ??
    getNestedStringValue(metaGroup, "urls", ["schedule", "runs", "overview"]) ??
    getNestedStringValue(firstRunGroup, "urls", ["schedule", "runs", "overview"]);

  const scheduleUrl = explicitScheduleUrl
    ? resolveFullpartyActionUrl(explicitScheduleUrl, fullpartyWebBaseUrl)
    : slug
      ? resolveFullpartyActionUrl(
          `/groups/${encodeURIComponent(slug)}/runs`,
          fullpartyWebBaseUrl,
        )
      : undefined;

  return {
    ...(name ? { name } : {}),
    ...(scheduleUrl ? { scheduleUrl } : {}),
  };
}

function getRunTitle(run: Record<string, unknown>): string | undefined {
  return (
    getStringValueFromKeys(run, [
      "title",
      "display_name",
      "activity_title",
      "name",
      "activity",
    ]) ??
    getNestedStringValue(run, "activity", ["title", "display_name", "name"]) ??
    getLocalizedLabel(getNestedUnknownValue(run, "activity_type", "name"))
  );
}

function getStartsAt(run: Record<string, unknown>): string | undefined {
  return (
    getStringValueFromKeys(run, ["starts_at", "start_at"]) ??
    getNestedStringValue(run, "activity", ["starts_at", "start_at"])
  );
}

function getTargetProgPoint(run: Record<string, unknown>): string | undefined {
  const label =
    getLocalizedLabel(getNestedUnknownValue(run, "target_prog_point", "label")) ??
    getStringValueFromKeys(run, ["target_prog_point_label"]);

  if (label) {
    return label;
  }

  const key =
    getStringValueFromKeys(run, ["target_prog_point_key"]) ??
    getNestedStringValue(run, "target_prog_point", ["key"]);

  return key ? humanizeIdentifier(key) : undefined;
}

type HostLabel = {
  discordUserId?: string;
  label: string;
};

function getHostLabel(run: Record<string, unknown>): HostLabel | undefined {
  const host = getRecordValue(run, "host");

  if (!host) {
    return undefined;
  }

  const discordUserId = getStringValueFromKeys(host, [
    "discord_user_id",
    "discordUserId",
  ]);

  if (discordUserId) {
    return {
      discordUserId,
      label: `<@${discordUserId}>`,
    };
  }

  const character = getRecordValue(host, "character");
  const characterName = getStringValueFromKeys(character, ["name", "display_name"]);

  if (characterName) {
    const world = getStringValueFromKeys(character, ["world"]);

    return {
      label: world ? `${characterName} [${world}]` : characterName,
    };
  }

  const hostName = getStringValueFromKeys(host, ["name", "username"]);

  return hostName ? { label: hostName } : undefined;
}

function getApplyUrl(
  run: Record<string, unknown>,
  fullpartyWebBaseUrl: string,
): string | undefined {
  const actionUrl =
    getNestedStringValue(run, "urls", [
      "apply",
      "application",
      "applications",
      "signup",
      "overview",
    ]) ??
    getStringValueFromKeys(run, [
      "apply_url",
      "application_url",
      "applications_url",
      "action_url",
      "url",
      "link",
    ]);

  return actionUrl
    ? resolveFullpartyActionUrl(actionUrl, fullpartyWebBaseUrl)
    : undefined;
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

function getNumberFromKeys(
  value: Record<string, unknown>,
  keys: string[],
): number | undefined {
  const counts = getRecordValue(value, "counts");

  for (const key of keys) {
    const directValue = getNumberValue(value[key]);
    const countValue = counts ? getNumberValue(counts[key]) : undefined;

    if (directValue !== undefined) {
      return directValue;
    }

    if (countValue !== undefined) {
      return countValue;
    }
  }

  return undefined;
}

function getArrayCountFromKeys(
  value: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const directValue = value[key];

    if (Array.isArray(directValue)) {
      return directValue.length;
    }
  }

  return undefined;
}

function getNumberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getStringValueFromKeys(value: unknown, keys: string[]): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  for (const key of keys) {
    const stringValue = getDisplayStringValue(value[key]);

    if (stringValue) {
      return stringValue;
    }
  }

  return undefined;
}

function getNestedStringValue(
  value: unknown,
  nestedKey: string,
  keys: string[],
): string | undefined {
  return getStringValueFromKeys(getRecordValue(value, nestedKey), keys);
}

function getNestedUnknownValue(value: unknown, nestedKey: string, key: string): unknown {
  const nestedValue = getRecordValue(value, nestedKey);

  return nestedValue ? nestedValue[key] : undefined;
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
