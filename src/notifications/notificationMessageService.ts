import {
  ButtonStyle,
  ComponentType,
  type APIEmbed,
  type APIEmbedField,
  type MessageCreateOptions,
} from "discord.js";

import {
  getNotificationCopy,
  getSupportedNotificationTypes,
} from "./notificationCopyCatalog.js";
import { formatNotificationCopy } from "./notificationFormatters.js";
import {
  humanizeIdentifier,
  resolveFullpartyActionUrl,
  truncateForDiscord,
} from "./notificationText.js";
import type {
  NotificationCopy,
  NotificationDeliveryData,
  NotificationTone,
} from "./types.js";

const embedDescriptionLimit = 4096;
const embedFieldNameLimit = 256;
const embedFieldValueLimit = 1024;
const embedTitleLimit = 256;
const blankFieldValue = "\u200b";
const buttonLabelLimit = 80;
const maxEmbedFields = 25;

const toneColors: Record<NotificationTone, number> = {
  danger: 0xd83c3e,
  info: 0x3b82f6,
  neutral: 0x6b7280,
  success: 0x22c55e,
  warning: 0xf59e0b,
};

export type NotificationMessageServiceOptions = {
  fullpartyWebBaseUrl: string;
};

export class NotificationMessageService {
  public constructor(private readonly options: NotificationMessageServiceOptions) {}

  public createDmMessage(data: NotificationDeliveryData): MessageCreateOptions {
    const copy = formatNotificationCopy(
      data,
      getNotificationCopy(data.notification.type),
    );
    const actionUrl = data.notification.action_url
      ? resolveFullpartyActionUrl(
          data.notification.action_url,
          this.options.fullpartyWebBaseUrl,
        )
      : undefined;
    const embed = this.createEmbed(data, copy, actionUrl);

    return {
      ...(actionUrl
        ? { components: createActionComponents(copy.actionLabel, actionUrl) }
        : {}),
      embeds: [embed],
    };
  }

  private createEmbed(
    data: NotificationDeliveryData,
    copy: NotificationCopy,
    actionUrl: string | undefined,
  ): APIEmbed {
    const presentation = createNotificationPresentation(copy.description);
    const embed: APIEmbed = {
      color: toneColors[copy.tone],
      description: truncateForDiscord(presentation.description, embedDescriptionLimit),
      footer: {
        text: `${getCategoryEmoji(data.notification.category)} FullParty • ${humanizeIdentifier(data.notification.category)}`,
      },
      ...(presentation.fields.length > 0 ? { fields: presentation.fields } : {}),
      title: truncateForDiscord(
        `${getNotificationEmoji(data.notification.type, copy.tone)} ${copy.title}`,
        embedTitleLimit,
      ),
    };
    const thumbnailUrl = getPayloadImageUrl(
      data.notification.payload,
      this.options.fullpartyWebBaseUrl,
    );

    if (actionUrl) {
      embed.url = actionUrl;
    }

    if (thumbnailUrl) {
      embed.thumbnail = {
        url: thumbnailUrl,
      };
    }

    return embed;
  }
}

export { getSupportedNotificationTypes };

function createActionComponents(
  actionLabel: string | undefined,
  actionUrl: string,
): NonNullable<MessageCreateOptions["components"]> {
  return [
    {
      components: [
        {
          emoji: {
            name: "🔗",
          },
          label: truncateForDiscord(actionLabel ?? "Open in FullParty", buttonLabelLimit),
          style: ButtonStyle.Link,
          type: ComponentType.Button,
          url: actionUrl,
        },
      ],
      type: ComponentType.ActionRow,
    },
  ];
}

type NotificationPresentation = {
  description: string;
  fields: APIEmbedField[];
};

function createNotificationPresentation(description: string): NotificationPresentation {
  const paragraphs = description.split(/\n\n+/u);
  const summary = paragraphs.shift() ?? description;
  const detailLines = paragraphs.join("\n").split("\n").filter(isNonEmptyString);

  return {
    description: decorateSummary(summary),
    fields: createDetailFields(detailLines),
  };
}

function decorateSummary(summary: string): string {
  return summary
    .split("\n")
    .map((line) => (line.startsWith("- ") ? `• ${line.slice(2)}` : line))
    .join("\n");
}

function createDetailFields(lines: string[]): APIEmbedField[] {
  const fields: APIEmbedField[] = [];
  let currentMultilineField: APIEmbedField | undefined;

  for (const line of lines) {
    if (line.startsWith("- ")) {
      if (currentMultilineField) {
        const currentValue =
          currentMultilineField.value === blankFieldValue
            ? ""
            : `${currentMultilineField.value}\n`;
        currentMultilineField.value = truncateForDiscord(
          `${currentValue}• ${line.slice(2)}`,
          embedFieldValueLimit,
        );
        currentMultilineField.inline = false;
      }
      continue;
    }

    const detail = parseDetailLine(line);

    if (!detail) {
      continue;
    }

    const field: APIEmbedField = {
      inline: isInlineDetailValue(detail.value),
      name: truncateForDiscord(detail.name, embedFieldNameLimit),
      value: truncateForDiscord(detail.value || blankFieldValue, embedFieldValueLimit),
    };

    fields.push(field);
    currentMultilineField = detail.value.length === 0 ? field : undefined;

    if (fields.length >= maxEmbedFields) {
      break;
    }
  }

  return fields;
}

type DetailLine = {
  name: string;
  value: string;
};

function parseDetailLine(line: string): DetailLine | undefined {
  const [label, ...rest] = line.split(":");

  if (!label || rest.length === 0) {
    return undefined;
  }

  const emoji = detailEmojiByLabel[label];
  const displayLabel = label === "Slot" ? "Party" : label;
  const displayName = emoji ? `${emoji} ${displayLabel}` : displayLabel;

  return {
    name: displayName,
    value: rest.join(":").trim(),
  };
}

function isInlineDetailValue(value: string): boolean {
  return value.length <= 80 && !value.includes("\n");
}

function getNotificationEmoji(type: string, tone: NotificationTone): string {
  const exactEmoji = notificationEmojiByType[type];

  if (exactEmoji) {
    return exactEmoji;
  }

  const namespace = type.split(".").at(0);

  if (namespace && notificationEmojiByNamespace[namespace]) {
    return notificationEmojiByNamespace[namespace];
  }

  return toneEmojiByTone[tone];
}

function getCategoryEmoji(category: string): string {
  return categoryEmojiByCategory[category] ?? "🔔";
}

const detailEmojiByLabel: Record<string, string> = {
  Attendance: "📍",
  Character: "👤",
  "Character Class": "🧩",
  Class: "🧩",
  "Completed at": "✅",
  "Entry mode": "📝",
  "Applications waiting": "📥",
  Milestones: "🏁",
  Notes: "📝",
  Position: "📍",
  Progress: "📈",
  "Progress link": "🔗",
  "Progress recorded": "📈",
  "Posted at": "📣",
  "Raid Position": "📍",
  Reason: "📝",
  "Scheduled start": "🕒",
  Slot: "🎯",
  Status: "📌",
  Password: "🔐",
  World: "🌍",
};

const notificationEmojiByType: Record<string, string> = {
  "applications.cancelled": "🗑️",
  "applications.declined": "⛔",
  "applications.new_for_review": "📥",
  "applications.submitted": "📨",
  "applications.updated": "📝",
  "applications.withdrawn": "↩️",
  "assignments.assigned": "✅",
  "assignments.designation_assigned": "👑",
  "assignments.designation_removed": "👑",
  "assignments.marked_missing": "⚠️",
  "assignments.missing_restored": "✅",
  "assignments.on_bench": "🪑",
  "assignments.returned_to_queue": "🔄",
  "assignments.roster_published_assigned": "📋",
  "assignments.roster_published_bench": "📋",
  "characters.added": "✨",
  "characters.primary_changed": "⭐",
  "characters.unclaimed": "👋",
  "runs.cancelled": "🚫",
  "runs.completed": "🏁",
  "runs.party_finder_published": "📢",
  "runs.starting_now": "🚀",
  "runs.starting_soon": "⏰",
  "system.announcement": "📣",
  "system.maintenance.upcoming": "🛠️",
  "user.social_account.linked": "🔗",
  "user.social_account.unlinked": "🔌",
};

const notificationEmojiByNamespace: Record<string, string> = {
  applications: "📋",
  assignments: "🎯",
  characters: "✨",
  runs: "🗓️",
  system: "📣",
  user: "👤",
};

const categoryEmojiByCategory: Record<string, string> = {
  account_character_updates: "👤",
  applications: "📋",
  assignments: "🎯",
  custom_events: "🔔",
  runs_and_reminders: "🗓️",
  system: "📣",
};

const toneEmojiByTone: Record<NotificationTone, string> = {
  danger: "🚫",
  info: "ℹ️",
  neutral: "🔔",
  success: "✅",
  warning: "⚠️",
};

function getPayloadImageUrl(
  payload: unknown,
  fullpartyWebBaseUrl: string,
): string | undefined {
  const imageUrl = findPayloadImageUrl(payload, 0);

  return imageUrl ? resolveFullpartyActionUrl(imageUrl, fullpartyWebBaseUrl) : undefined;
}

function findPayloadImageUrl(value: unknown, depth: number): string | undefined {
  if (depth > 5 || typeof value !== "object" || value === null) {
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nestedImageUrl = findPayloadImageUrl(item, depth + 1);

      if (nestedImageUrl) {
        return nestedImageUrl;
      }
    }

    return undefined;
  }

  const record = value as Record<string, unknown>;

  for (const key of payloadImageUrlKeys) {
    const imageUrl = record[key];

    if (typeof imageUrl === "string" && imageUrl.trim().length > 0) {
      return imageUrl;
    }
  }

  for (const nestedValue of Object.values(record)) {
    const nestedImageUrl = findPayloadImageUrl(nestedValue, depth + 1);

    if (nestedImageUrl) {
      return nestedImageUrl;
    }
  }

  return undefined;
}

const payloadImageUrlKeys = [
  "avatar_url",
  "icon_url",
  "flaticon_url",
  "small_image_url",
  "banner_image_url",
  "image_url",
];

function isNonEmptyString(value: string): boolean {
  return value.trim().length > 0;
}
