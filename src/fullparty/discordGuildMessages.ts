import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type APIEmbed,
  type APIEmbedField,
  type InteractionEditReplyOptions,
} from "discord.js";

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
const pageSize = 1;

export type GuildUpcomingRunsPaginationOptions = {
  guildId: string;
  limit: number;
  page: number;
  requesterId: string;
};

export function createGuildUpcomingRunsMessage(
  response: unknown,
  fullpartyWebBaseUrl: string,
  pagination?: GuildUpcomingRunsPaginationOptions,
): InteractionEditReplyOptions {
  const runs = extractCollection(response, ["upcoming_runs", "runs", "items", "data"]);

  if (runs.length === 0) {
    return {
      components: [],
      content: "No upcoming FullParty runs were found for this Discord server.",
    };
  }

  if (pagination) {
    return createPaginatedGuildUpcomingRunsMessage(runs, fullpartyWebBaseUrl, pagination);
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

function createPaginatedGuildUpcomingRunsMessage(
  runs: Record<string, unknown>[],
  fullpartyWebBaseUrl: string,
  pagination: GuildUpcomingRunsPaginationOptions,
): InteractionEditReplyOptions {
  const pageCount = Math.max(1, Math.ceil(runs.length / pageSize));
  const page = clampPage(pagination.page, pageCount);
  const visibleRuns = runs.slice(page * pageSize, page * pageSize + pageSize);
  const visibleRun = visibleRuns[0];
  const pageLabel = `Page ${String(page + 1)}/${String(pageCount)}`;

  return {
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(
            createGuildRunsPageCustomId({
              ...pagination,
              page: Math.max(0, page - 1),
            }),
          )
          .setDisabled(page === 0)
          .setEmoji("⬅️")
          .setLabel("Previous")
          .setStyle(ButtonStyle.Secondary),
        createRunLinkButton({
          customId: createGuildRunsNoopCustomId(pagination, page, "overview"),
          emoji: "🔎",
          label: "Overview",
          url: visibleRun ? getActionUrl(visibleRun, fullpartyWebBaseUrl) : undefined,
        }),
        createRunLinkButton({
          customId: createGuildRunsNoopCustomId(pagination, page, "manage"),
          emoji: "🛠️",
          label: "Manage",
          url: visibleRun ? getManagementUrl(visibleRun, fullpartyWebBaseUrl) : undefined,
        }),
        createAssignRoleButton(visibleRun, pagination, page),
        new ButtonBuilder()
          .setCustomId(
            createGuildRunsPageCustomId({
              ...pagination,
              page: Math.min(pageCount - 1, page + 1),
            }),
          )
          .setDisabled(page >= pageCount - 1)
          .setEmoji("➡️")
          .setLabel("Next")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
    content: [
      `Found ${String(runs.length)} upcoming FullParty ${runs.length === 1 ? "run" : "runs"} for this server.`,
      pageLabel,
    ].join(" "),
    embeds: visibleRuns.map((run) => ({
      ...createGuildRunEmbed(run, fullpartyWebBaseUrl),
      footer: {
        text: `FullParty - Guild Runs • ${pageLabel}`,
      },
    })),
  };
}

export function createGuildRunsPageCustomId(
  pagination: GuildUpcomingRunsPaginationOptions,
): string {
  return [
    "guildruns",
    pagination.guildId,
    pagination.requesterId,
    String(pagination.limit),
    String(pagination.page),
  ].join(":");
}

export function createGuildRunsAssignCustomId(
  pagination: GuildUpcomingRunsPaginationOptions,
  runId: string,
): string {
  return [
    "guildruns",
    "assign",
    pagination.guildId,
    pagination.requesterId,
    String(pagination.limit),
    String(pagination.page),
    runId,
  ].join(":");
}

function createAssignRoleButton(
  run: Record<string, unknown> | undefined,
  pagination: GuildUpcomingRunsPaginationOptions,
  page: number,
): ButtonBuilder {
  const runId = run ? getRunId(run) : undefined;
  const button = new ButtonBuilder()
    .setCustomId(
      runId
        ? createGuildRunsAssignCustomId({ ...pagination, page }, runId)
        : createGuildRunsNoopCustomId(pagination, page, "assign"),
    )
    .setDisabled(!runId)
    .setEmoji("🛡️")
    .setLabel("Assign Role")
    .setStyle(ButtonStyle.Primary);

  return button;
}

function createRunLinkButton(options: {
  customId: string;
  emoji: string;
  label: string;
  url: string | undefined;
}): ButtonBuilder {
  if (!options.url) {
    return new ButtonBuilder()
      .setCustomId(options.customId)
      .setDisabled(true)
      .setEmoji(options.emoji)
      .setLabel(options.label)
      .setStyle(ButtonStyle.Secondary);
  }

  return new ButtonBuilder()
    .setEmoji(options.emoji)
    .setLabel(options.label)
    .setStyle(ButtonStyle.Link)
    .setURL(options.url);
}

function createGuildRunsNoopCustomId(
  pagination: GuildUpcomingRunsPaginationOptions,
  page: number,
  key: string,
): string {
  return [
    "guildruns",
    "noop",
    key,
    pagination.guildId,
    pagination.requesterId,
    String(pagination.limit),
    String(page),
  ].join(":");
}

function clampPage(page: number, pageCount: number): number {
  if (!Number.isFinite(page)) {
    return 0;
  }

  return Math.max(0, Math.min(pageCount - 1, Math.floor(page)));
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

function getManagementUrl(
  value: Record<string, unknown>,
  fullpartyWebBaseUrl: string,
): string | undefined {
  const explicitUrl =
    getStringValueFromKeys(value, ["management_url", "manage_url", "dashboard_url"]) ??
    getNestedStringValue(value.urls, ["management", "manage", "dashboard"]);

  if (explicitUrl) {
    return resolveFullpartyActionUrl(explicitUrl, fullpartyWebBaseUrl);
  }

  const groupSlug =
    getStringValueFromKeys(value, ["group_slug"]) ??
    getNestedStringValue(value.group, ["slug"]);
  const runId = getRunId(value);

  return groupSlug && runId
    ? resolveFullpartyActionUrl(
        `/dashboard/groups/${encodeURIComponent(groupSlug)}/runs/${encodeURIComponent(runId)}`,
        fullpartyWebBaseUrl,
      )
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
