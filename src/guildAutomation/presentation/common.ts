import type { APIEmbed, APIEmbedField, MessageCreateOptions } from "discord.js";
import { formatDiscordDateTime } from "../../lib/discordTimestamps.js";
import type { GuildRunCompletedData, GuildRunReminderData } from "../runReminderTypes.js";
import { createFailureDetailsButtonRow } from "./failures.js";

export function buildGuildRunAutomationStartedMessage(
  data: GuildRunReminderData,
): MessageCreateOptions {
  const runName = getRunAutomationActivityTitle(data);
  const runLabel =
    data.reminder_type === "starting_now"
      ? `Run #${String(data.run_id)} Starting Now`
      : `Upcoming Run #${String(data.run_id)}`;
  const startsLine = formatRunStartsLine(data.starts_at);

  return {
    allowedMentions: {
      parse: [],
    },
    content: [
      `⚙️ Automation started for ${runLabel}${runName ? `: ${runName}` : ""}.`,
      startsLine,
      "Role assignment and nickname sync status will follow here.",
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n"),
  };
}

export type SyncStatus = {
  color: number;
  titleSuffix: string;
};

export function createBotLogEmbedMessage(options: {
  color: number;
  description: string;
  failureDetailsId?: string | undefined;
  fields: APIEmbedField[];
  title: string;
}): MessageCreateOptions {
  const embed: APIEmbed = {
    color: options.color,
    description: options.description,
    fields: options.fields,
    footer: {
      text: "FullParty • Guild Automation",
    },
    title: options.title,
  };

  return {
    allowedMentions: {
      parse: [],
    },
    ...(options.failureDetailsId
      ? { components: [createFailureDetailsButtonRow(options.failureDetailsId)] }
      : {}),
    embeds: [embed],
  };
}

export function createRunReminderDescription(
  data: GuildRunReminderData,
  requestedUserCount: number,
  skippedReason?: string,
): string {
  const action = skippedReason ? "Checked" : "Processed";
  const runLine = [
    `**Run #${String(data.run_id)}**`,
    formatReminderType(data.reminder_type),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" • ");

  return [
    runLine,
    formatRunStartsLine(data.starts_at),
    data.group_slug ? `**Group:** ${data.group_slug}` : undefined,
    `${action} **${String(requestedUserCount)}** ${formatPlural(requestedUserCount, "user")}.`,
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

export function getRunAutomationActivityTitle(
  data: GuildRunReminderData | GuildRunCompletedData,
): string | undefined {
  return data.activity_title ?? data.activity;
}

export function formatRunStartsLine(startsAt: string | undefined): string | undefined {
  const timestamp = formatDiscordDateTime(startsAt);

  return timestamp ? `**Starts:** ${timestamp}` : undefined;
}

export function formatRunReminderSkippedReason(reason: string): string {
  const knownReasons: Record<string, string> = {
    bot_missing_manage_roles:
      "The bot needs the Manage Roles permission to create, delete, and assign run roles.",
    nickname_sync_disabled: "Nickname sync is disabled in `/setup`.",
    no_discord_users: "FullParty did not include any Discord users for this run.",
    no_nickname_targets:
      "No participants included both a Discord user and primary character to sync.",
    run_role_mapping_not_found:
      "No active temporary role is mapped for this run. It may have already been cleaned up.",
    run_role_store_not_configured:
      "The bot's run-role database is not configured, so temporary run roles cannot be tracked safely.",
    template_role_not_below_bot:
      "The template role must be below the bot's highest role in Discord role settings.",
    template_role_not_found:
      "The configured template role was not found. Re-run `/setup` and choose a valid role.",
    upcoming_raider_role_not_configured:
      "Run role template is not configured in `/setup`.",
  };

  return knownReasons[reason] ?? reason.replaceAll("_", " ");
}

export function formatReminderType(
  reminderType: GuildRunReminderData["reminder_type"],
): string {
  return reminderType === "starting_now" ? "🚨 **Starting Now**" : "🕒 **Upcoming**";
}

export function formatPercent(successfulCount: number, requestedCount: number): string {
  if (requestedCount === 0) {
    return "0.0%";
  }

  return `${((successfulCount / requestedCount) * 100).toFixed(1)}%`;
}

export function formatPlural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

export function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
