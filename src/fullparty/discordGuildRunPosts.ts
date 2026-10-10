import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  escapeMarkdown,
  type APIButtonComponentWithURL,
  type APIContainerComponent,
  type APIMessageTopLevelComponent,
  type APITextDisplayComponent,
} from "discord.js";

import type { ScheduleFormat } from "../guildSchedule/settings.js";
import { formatDiscordDateTime } from "../lib/discordTimestamps.js";
import {
  humanizeIdentifier,
  resolveFullpartyActionUrl,
  truncateForDiscord,
} from "../notifications/notificationText.js";

const discordMessageLimit = 2000;
const truncationBuffer = 160;

export type SchedulePostMessage = {
  content?: string;
  flags?: MessageFlags.IsComponentsV2;
  components?: APIMessageTopLevelComponent[];
  allowedMentions: { parse: []; repliedUser?: false };
};

export function createGuildUpcomingRunsPostMessage(
  response: unknown,
  fullpartyWebBaseUrl: string,
  format: ScheduleFormat = "plain",
): SchedulePostMessage {
  const runs = extractCollection(response, ["upcoming_runs", "runs", "items", "data"]);
  if (format === "expanded") {
    return createExpandedPost(response, runs, fullpartyWebBaseUrl);
  }
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
    },
    content: truncateForDiscord(lines.join("\n"), discordMessageLimit),
  };
}

function createExpandedPost(
  response: unknown,
  runs: Record<string, unknown>[],
  fullpartyWebBaseUrl: string,
): SchedulePostMessage {
  const group = getGroupInfo(response, runs, fullpartyWebBaseUrl, safeScheduleUrl);
  if (group.name) group.name = safeExpandedText(group.name, 120);
  const components: APIMessageTopLevelComponent[] = [];
  const footer = createFooter(group);
  // Leave room for the overflow line and footer. Budget for custom emoji markup
  // before delivery resolves the icon aliases, including any aliases in run titles.
  let textBudget = 4000 - expandedTextLength(footer) - 100;
  let componentBudget = 39;

  for (const run of runs) {
    const card = createExpandedRunCard(run, fullpartyWebBaseUrl);
    if (card.textLength > textBudget || card.componentCount > componentBudget) {
      break;
    }
    components.push(card.component);
    textBudget -= card.textLength;
    componentBudget -= card.componentCount;
  }

  const hiddenRunCount = runs.length - components.length;
  const summary =
    runs.length === 0
      ? group.name
        ? `No upcoming FullParty runs were found for **${group.name}** right now.`
        : "No upcoming FullParty runs were found right now."
      : hiddenRunCount > 0
        ? `...and ${String(hiddenRunCount)} more upcoming ${hiddenRunCount === 1 ? "run" : "runs"}.`
        : undefined;
  components.push(expandedText([summary, footer].filter(Boolean).join("\n\n")));

  return {
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [], repliedUser: false },
    components,
  };
}

function createExpandedRunCard(
  run: Record<string, unknown>,
  fullpartyWebBaseUrl: string,
): { component: APIContainerComponent; componentCount: number; textLength: number } {
  const title = getRunTitle(run) ?? "Upcoming FullParty run";
  const target = getTargetProgPoint(run);
  const heading = `## ${safeExpandedText(target ? `${title} - ${target}` : title, 220)}`;
  const startsAt = formatDiscordDateTime(getStartsAt(run)) ?? "Time TBD";
  const runUrl = getRunUrl(run, fullpartyWebBaseUrl);
  const applyUrl = getApplyUrl(run, fullpartyWebBaseUrl, safeScheduleUrl);
  const buttons: APIButtonComponentWithURL[] = [];
  for (const [label, url] of [
    ["View Run", runUrl],
    ["Apply Now", applyUrl],
  ]) {
    if (url && label) {
      buttons.push({ type: ComponentType.Button, style: ButtonStyle.Link, label, url });
    }
  }
  const host = getExpandedHostLabel(run);
  const details = [
    `:fpclock: **Scheduled Start:** ${startsAt}`,
    `:fpnametag: ${formatParticipantCount(run)} - ${formatApplicationCount(run).replace(/ Applications$/u, " Application(s)")}`,
    `:fpatsymbol: Hosted By ${host}`,
  ].join("\n");
  const avatarUrl = getHostAvatarUrl(run, fullpartyWebBaseUrl);
  const component: APIContainerComponent = {
    type: ComponentType.Container,
    accent_color: 9917105,
    components: [
      expandedText(heading),
      avatarUrl
        ? {
            type: ComponentType.Section,
            components: [expandedText(details)],
            accessory: {
              type: ComponentType.Thumbnail,
              media: { url: avatarUrl },
              description: "Host profile picture",
            },
          }
        : expandedText(details),
    ],
  };
  if (buttons.length) {
    component.components.push({ type: ComponentType.ActionRow, components: buttons });
  }
  return {
    component,
    componentCount: (avatarUrl ? 5 : 3) + (buttons.length ? 1 + buttons.length : 0),
    textLength: expandedTextLength(heading) + expandedTextLength(details),
  };
}

function expandedText(content: string): APITextDisplayComponent {
  return { type: ComponentType.TextDisplay, content };
}

function expandedTextLength(content: string): number {
  // An animated emoji with a 20-digit snowflake adds 23 characters to :name:.
  return content.length + (content.match(/:fp[a-z]+:/gu)?.length ?? 0) * 23;
}

function safeExpandedText(value: string, length: number): string {
  return truncateForDiscord(
    escapeMarkdown(value.replace(/\s+/gu, " ").replace(/@/gu, "@\u200b"), {
      maskedLink: true,
    }),
    length,
  );
}

function getExpandedHostLabel(run: Record<string, unknown>): string {
  const host = getHostLabel(run);
  if (!host) return "Host unavailable";
  if (host.discordUserId && /^\d{17,20}$/u.test(host.discordUserId)) {
    return `<@${host.discordUserId}>`;
  }
  // Do not render arbitrary text from a malformed Discord ID as mention markup.
  return host.discordUserId ? "Host unavailable" : safeExpandedText(host.label, 120);
}

function getHostAvatarUrl(
  run: Record<string, unknown>,
  fullpartyWebBaseUrl: string,
): string | undefined {
  const host = getRecordValue(run, "host");
  for (const value of [
    getStringValueFromKeys(host, ["avatar_url"]),
    getNestedStringValue(host, "character", ["avatar_url"]),
  ]) {
    if (!value) continue;
    const url = safeScheduleUrl(value, fullpartyWebBaseUrl, 2048);
    if (url) return url;
  }
  return undefined;
}

function safeScheduleUrl(
  value: string,
  fullpartyWebBaseUrl: string,
  maxLength = 512,
): string | undefined {
  try {
    const url = new URL(value, fullpartyWebBaseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      return undefined;
    }
    const result = url.toString().replace(/[<>]/gu, (char) => encodeURIComponent(char));
    return result.length <= maxLength ? result : undefined;
  } catch {
    return undefined;
  }
}

function createRunBlock(
  run: Record<string, unknown>,
  fullpartyWebBaseUrl: string,
): {
  lines: string[];
} {
  const title = getRunTitle(run) ?? "Upcoming FullParty run";
  const targetProgPoint = getTargetProgPoint(run);
  const titleWithProgPoint = targetProgPoint ? `${title} - ${targetProgPoint}` : title;
  const startsAt = formatDiscordDateTime(getStartsAt(run)) ?? "Time TBD";
  const applyUrl = getApplyUrl(run, fullpartyWebBaseUrl);
  const applyLine = applyUrl
    ? createSuppressedEmbedMarkdownLink("Apply Here", applyUrl)
    : "Apply on FullParty";
  const host = getHostLabel(run);

  return {
    lines: [
      `**${titleWithProgPoint}**`,
      `${formatParticipantCount(run)} - ${formatApplicationCount(run)} - ${startsAt}`,
      host ? `Hosted by ${host.label} - ${applyLine}` : applyLine,
    ],
  };
}

function createFooter(group: GuildPostGroupInfo): string {
  const scheduleLink = group.scheduleUrl
    ? createSuppressedEmbedMarkdownLink("Click Here", group.scheduleUrl)
    : "check FullParty";

  return group.name
    ? `-# For the full schedule of **${group.name}** ${scheduleLink}`
    : `-# For the full schedule ${scheduleLink}`;
}

function createSuppressedEmbedMarkdownLink(label: string, url: string): string {
  return `[${label}](<${url}>)`;
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
  resolveUrl: (
    value: string,
    baseUrl: string,
  ) => string | undefined = resolveFullpartyActionUrl,
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
    ? resolveUrl(explicitScheduleUrl, fullpartyWebBaseUrl)
    : slug
      ? resolveUrl(
          `/en/groups/${encodeURIComponent(slug)}/dashboard/activities`,
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

function getRunUrl(
  run: Record<string, unknown>,
  fullpartyWebBaseUrl: string,
): string | undefined {
  const url =
    getNestedStringValue(run, "urls", ["overview", "run", "activity", "view"]) ??
    getStringValueFromKeys(run, ["run_url", "activity_url", "url", "link"]);
  return url ? safeScheduleUrl(url, fullpartyWebBaseUrl) : undefined;
}

function getApplyUrl(
  run: Record<string, unknown>,
  fullpartyWebBaseUrl: string,
  resolveUrl: (
    value: string,
    baseUrl: string,
  ) => string | undefined = resolveFullpartyActionUrl,
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

  return actionUrl ? resolveUrl(actionUrl, fullpartyWebBaseUrl) : undefined;
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
