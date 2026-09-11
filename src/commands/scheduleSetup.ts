import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  StringSelectMenuBuilder,
  escapeMarkdown,
} from "discord.js";
import type { BotContext } from "../bot/context.js";
import type { GuildSettings, GuildSettingsPatch } from "../guildSettings/types.js";
import {
  formatScheduleInterval,
  scheduleIntervalDaysSchema,
  scheduleIntervals,
} from "../guildSchedule/settings.js";
import type { ScheduleState } from "../guildSchedule/store.js";
import { CommandError } from "./commandError.js";
import type { SetupComponentInteraction } from "./types.js";

export const ScheduleCustomId = {
  Open: "setup:schedule:open",
  Channel: "setup:schedule:channel",
  Interval: "setup:schedule:interval",
  Enable: "setup:schedule:enable",
  Disable: "setup:schedule:disable",
  Back: "setup:back",
} as const;

export async function handleScheduleSetup(
  interaction: SetupComponentInteraction,
  context: BotContext,
  guildId: string,
  preflight: (patch: GuildSettingsPatch) => Promise<string | undefined>,
): Promise<void> {
  let settings = await context.guildSettings.get(guildId);
  const patch: GuildSettingsPatch = {};
  switch (interaction.customId) {
    case ScheduleCustomId.Open:
      break;
    case ScheduleCustomId.Channel:
      if (!interaction.isChannelSelectMenu() || !interaction.values[0])
        throw new CommandError("Choose a schedule channel.", "schedule_channel_required");
      patch.scheduleRefreshChannelId = interaction.values[0];
      break;
    case ScheduleCustomId.Interval: {
      if (!interaction.isStringSelectMenu())
        throw new CommandError(
          "Choose a refresh frequency.",
          "schedule_frequency_required",
        );
      const result = scheduleIntervalDaysSchema.safeParse(Number(interaction.values[0]));
      if (!result.success)
        throw new CommandError(
          "Choose a refresh interval from 1 to 7 days.",
          "schedule_frequency_invalid",
        );
      patch.scheduleRefreshIntervalDays = result.data;
      break;
    }
    case ScheduleCustomId.Enable:
      if (!settings.linkedAt || !settings.scheduleRefreshChannelId) {
        await interaction.update(
          buildSchedulePanel(
            settings,
            context.guildScheduleStore?.get(guildId),
            !settings.linkedAt
              ? "Link this server to FullParty with /link before enabling automatic schedules."
              : "Choose a schedule channel before enabling automatic refresh.",
          ),
        );
        return;
      }
      patch.scheduleRefreshEnabled = true;
      break;
    case ScheduleCustomId.Disable:
      patch.scheduleRefreshEnabled = false;
      break;
    default:
      throw new CommandError(
        "That schedule control is no longer available. Run /setup again.",
        "schedule_control_invalid",
      );
  }
  const warning = await preflight(patch);
  if (Object.keys(patch).length)
    settings = await context.guildSettings.update(guildId, patch);
  await interaction.update(
    buildSchedulePanel(settings, context.guildScheduleStore?.get(guildId), warning),
  );
}

function buildSchedulePanel(
  settings: GuildSettings,
  state?: ScheduleState,
  warning?: string,
) {
  const enabled = settings.scheduleRefreshEnabled ?? false;
  const interval = settings.scheduleRefreshIntervalDays ?? 1;
  const channel = new ChannelSelectMenuBuilder()
    .setCustomId(ScheduleCustomId.Channel)
    .setPlaceholder("Choose automatic schedule channel")
    .setMinValues(1)
    .setMaxValues(1)
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
  if (settings.scheduleRefreshChannelId)
    channel.setDefaultChannels(settings.scheduleRefreshChannelId);
  const frequency = new StringSelectMenuBuilder()
    .setCustomId(ScheduleCustomId.Interval)
    .setPlaceholder("Refresh frequency")
    .addOptions(
      scheduleIntervals.map((days) => ({
        label: formatScheduleInterval(days),
        value: String(days),
        default: days === interval,
      })),
    );
  return {
    content: [
      "**Automatic Schedule**",
      `Status: **${enabled ? "Enabled" : "Disabled"}**`,
      `Channel: ${settings.scheduleRefreshChannelId ? `<#${settings.scheduleRefreshChannelId}>` : "_Not set_"}`,
      `Frequency: **${formatScheduleInterval(interval)}**`,
      enabled && state
        ? `Next refresh: <t:${String(Math.floor(Date.parse(state.next_refresh_at) / 1000))}:R>`
        : undefined,
      state?.last_refreshed_at
        ? `Last posted: <t:${String(Math.floor(Date.parse(state.last_refreshed_at) / 1000))}:f>`
        : undefined,
      state?.last_error
        ? `Last issue: ${escapeMarkdown(state.last_error).slice(0, 400)}`
        : undefined,
      "",
      "The previous automatic schedule is deleted and a fresh /postruns-style summary is posted. Manual schedule posts are left alone; hosts are not pinged.",
      "Enabling or changing the settings schedules a refresh within a minute. Disabling leaves the last post in place.",
      warning ? `\n${warning}` : undefined,
    ]
      .filter((line) => line !== undefined)
      .join("\n"),
    allowedMentions: { parse: [] },
    components: [
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(channel),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(frequency),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(ScheduleCustomId.Enable)
          .setLabel("Enable")
          .setStyle(ButtonStyle.Success)
          .setDisabled(enabled),
        new ButtonBuilder()
          .setCustomId(ScheduleCustomId.Disable)
          .setLabel("Disable")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(!enabled),
        new ButtonBuilder()
          .setCustomId(ScheduleCustomId.Back)
          .setLabel("Back to setup")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}
