import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type APIMessageTopLevelComponent,
} from "discord.js";
import { ScheduleCustomId } from "../commands/setupIds.js";
import { createGuildUpcomingRunsPostMessage } from "../fullparty/discordGuildRunPosts.js";
import {
  formatScheduleFormat,
  getSchedulePostFormat,
  schedulePostFormatSchema,
  type ScheduleFormat,
} from "../guildSchedule/settings.js";
import type { SetupV2Message } from "./setupMessages.js";

// Sample data only. The avatar is Giki Chomusuke's public Lodestone profile image:
// https://eu.finalfantasyxiv.com/lodestone/character/47431834/
export const schedulePreviewResponse = {
  data: [
    {
      title: "Cloud Of Darkness - Run2 Electric Boogaloo",
      starts_at: "2026-10-22T16:00:00Z",
      participant_count: 3,
      participant_capacity: 48,
      applications_count: 1,
      host: {
        character: { name: "Giki Chomusuke", world: "Lich" },
        avatar_url:
          "https://img2.finalfantasyxiv.com/f/15cff6ad5af687333d4ae7545c7b4ec4_7206469080400ed57a5373d0a9c55c59fc0.jpg?1791650372",
      },
      urls: { overview: "https://fullparty.gg", apply: "https://fullparty.gg" },
    },
  ],
  meta: {
    group: {
      name: "Forked Tower Enjoyers Light",
      urls: { schedule: "https://fullparty.gg" },
    },
  },
};

export function buildScheduleFormatPicker(
  format: ScheduleFormat = "plain",
): SetupV2Message {
  const selected = getSchedulePostFormat(format);
  const preview = createGuildUpcomingRunsPostMessage(
    schedulePreviewResponse,
    "https://fullparty.gg",
    selected,
  );
  const previewComponents: APIMessageTopLevelComponent[] = preview.components ?? [
    {
      type: ComponentType.TextDisplay,
      content: preview.content ?? "No preview available.",
    },
  ];

  return {
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [], repliedUser: false },
    components: [
      {
        type: ComponentType.Container,
        accent_color: 9912567,
        components: [
          {
            type: ComponentType.TextDisplay,
            content:
              "## Schedule Format\nChoose the style of your schedule listings.\n-# Preview changes below. Your choice is applied only when you save.",
          },
          {
            type: ComponentType.ActionRow,
            components: [
              {
                type: ComponentType.StringSelect,
                custom_id: ScheduleCustomId.FormatValue,
                min_values: 1,
                max_values: 1,
                options: schedulePostFormatSchema.options.map((value) => ({
                  label: formatScheduleFormat(value),
                  value,
                  default: value === selected,
                })),
              },
            ],
          },
        ],
      },
      {
        type: ComponentType.TextDisplay,
        content: "### Preview\n-# Sample run — not a live listing.",
      },
      ...previewComponents,
      { type: ComponentType.Separator, spacing: 2, divider: true },
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.Button,
            style: ButtonStyle.Secondary,
            label: "Back",
            custom_id: ScheduleCustomId.Open,
          },
          {
            type: ComponentType.Button,
            style: ButtonStyle.Success,
            label: "Save",
            custom_id: `${ScheduleCustomId.FormatSave}:${selected}`,
          },
        ],
      },
    ],
  };
}
