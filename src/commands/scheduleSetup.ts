import type { BotContext } from "../bot/context.js";
import { buildSetupPanel } from "../discord/setupMessages.js";
import type { GuildSettings, GuildSettingsPatch } from "../guildSettings/types.js";
import {
  scheduleIntervalDaysSchema,
  scheduleModeSchema,
} from "../guildSchedule/settings.js";
import { CommandError } from "./commandError.js";
import { ScheduleCustomId, SetupCustomId } from "./setupIds.js";
import type { SetupComponentInteraction } from "./types.js";

export async function handleScheduleSetup(
  interaction: SetupComponentInteraction,
  context: BotContext,
  guildId: string,
  preflight: (
    patch: GuildSettingsPatch,
    settings: GuildSettings,
  ) => Promise<string | undefined>,
): Promise<void> {
  let settings = await context.guildSettings.get(guildId);
  const patch: GuildSettingsPatch = {};
  let warning: string | undefined;
  if (
    [ScheduleCustomId.Open, ScheduleCustomId.Enable, ScheduleCustomId.Disable].some(
      (customId) => customId === interaction.customId,
    ) &&
    !interaction.isButton()
  ) {
    throw new CommandError("Choose a schedule action.", "schedule_control_invalid");
  }
  switch (interaction.customId) {
    case ScheduleCustomId.Open:
      break;
    case SetupCustomId.ScheduleChannel:
    case SetupCustomId.LegacyRunAnnouncementChannel:
    case ScheduleCustomId.Channel:
      if (!interaction.isChannelSelectMenu() || !interaction.values[0])
        throw new CommandError("Choose a schedule channel.", "schedule_channel_required");
      patch.runAnnouncementChannelId = interaction.values[0];
      break;
    case ScheduleCustomId.Mode: {
      if (!interaction.isStringSelectMenu())
        throw new CommandError("Choose a schedule mode.", "schedule_mode_required");
      const result = scheduleModeSchema.safeParse(interaction.values[0]);
      if (!result.success)
        throw new CommandError("Choose a valid schedule mode.", "schedule_mode_invalid");
      patch.scheduleMode = result.data;
      break;
    }
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
      patch.scheduleMode = "timed_refresh";
      break;
    case ScheduleCustomId.Disable:
      patch.scheduleMode = "disabled";
      break;
    default:
      throw new CommandError(
        "That schedule control is no longer available. Run /setup again.",
        "schedule_control_invalid",
      );
  }
  if (
    patch.scheduleMode &&
    patch.scheduleMode !== "disabled" &&
    (!settings.linkedAt || !settings.runAnnouncementChannelId)
  ) {
    warning = !settings.linkedAt
      ? "Link this server to FullParty with /link before enabling automatic schedules."
      : "Choose a schedule channel before enabling automatic updates.";
    delete patch.scheduleMode;
  }
  if (Object.keys(patch).length) {
    warning = await preflight(patch, settings);
    settings = await context.guildSettings.update(guildId, patch);
  }
  const scheduleState = context.guildScheduleStore?.get(guildId);
  await interaction.editReply({
    ...buildSetupPanel(settings, "schedule", {
      ...(scheduleState ? { scheduleState } : {}),
      ...(warning ? { warning } : {}),
    }),
    content: null,
    embeds: [],
  });
}
