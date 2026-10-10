import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  SeparatorSpacingSize,
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIComponentInMessageActionRow,
  type APIMessageTopLevelComponent,
  type MessageCreateOptions,
} from "discord.js";
import type { GuildRunReminderData } from "../runReminderTypes.js";
import type { RunReminderFailure } from "../types.js";
import { formatPlural, formatRunStartsLine, truncateText } from "./common.js";
import { createFailureDetailsButtonRow, createFailuresField } from "./failures.js";

export function createAutomationV2Message(options: {
  title: string;
  description: string;
  statistics: string;
  note: string;
  failures: RunReminderFailure[];
  failureColor: number;
  failureDetailsId?: string | undefined;
  runUrl?: string | undefined;
}): MessageCreateOptions {
  const components: APIMessageTopLevelComponent[] = [
    text(`## ${options.title}\n${options.description}`),
    separator(),
    text(options.statistics),
    separator(),
    {
      type: ComponentType.Container,
      accent_color: 11974326,
      components: [text(`### :fpnote: Note\n${truncateText(options.note, 1000)}`)],
    },
  ];
  const failureField = createFailuresField(options.failures);

  if (failureField) {
    components.push({
      type: ComponentType.Container,
      accent_color: options.failureColor,
      components: [text(`## Failure Details\n${truncateText(failureField.value, 1000)}`)],
    });
  }

  const buttons: APIButtonComponent[] = options.failureDetailsId
    ? [...createFailureDetailsButtonRow(options.failureDetailsId).components]
    : [];

  if (options.runUrl && isRunLink(options.runUrl)) {
    buttons.push({
      type: ComponentType.Button,
      style: ButtonStyle.Link,
      label: "View Run",
      url: options.runUrl,
    });
  }

  if (buttons.length > 0) {
    const row: APIActionRowComponent<APIComponentInMessageActionRow> = {
      type: ComponentType.ActionRow,
      components: buttons,
    };
    components.push(row);
  }

  components.push(text("-# FullParty • Discord Automation"));

  return {
    allowedMentions: { parse: [] },
    components,
    flags: MessageFlags.IsComponentsV2,
  };
}

export function createAutomationV2RunDescription(
  data: GuildRunReminderData,
  requestedUserCount: number,
  skippedReason: string | undefined,
): string {
  return [
    `**Run #${String(data.run_id)}** • ${data.reminder_type === "starting_now" ? "Starting Now" : "Upcoming"}`,
    formatRunStartsLine(data.starts_at ?? data.run?.starts_at ?? undefined),
    data.group_slug ? `**Group:** ${truncateText(data.group_slug, 256)}` : undefined,
    `${skippedReason ? "Checked" : "Processed"} **${String(requestedUserCount)}** ${formatPlural(requestedUserCount, "user")}.`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function text(content: string) {
  return { type: ComponentType.TextDisplay as const, content };
}

function separator() {
  return {
    type: ComponentType.Separator as const,
    divider: true,
    spacing: SeparatorSpacingSize.Large,
  };
}

function isRunLink(value: string): boolean {
  if (value.length > 512) {
    return false;
  }

  try {
    return ["https:", "http:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
