import type { BotContext } from "../bot/context.js";
import { buildScheduleFormatPicker } from "../discord/scheduleFormatPicker.js";
import { buildSetupPanel } from "../discord/setupMessages.js";
import { resolveV2MessageIcons } from "../discord/v2.js";
import {
  getSchedulePostFormat,
  schedulePostFormatSchema,
} from "../guildSchedule/settings.js";
import { CommandError } from "./commandError.js";
import { ScheduleCustomId } from "./setupIds.js";
import type { SetupComponentInteraction } from "./types.js";

export async function handleScheduleFormatSetup(
  interaction: SetupComponentInteraction,
  context: BotContext,
  guildId: string,
): Promise<void> {
  let selected: unknown;
  const saving = interaction.customId.startsWith(`${ScheduleCustomId.FormatSave}:`);
  if (interaction.customId === ScheduleCustomId.FormatOpen && interaction.isButton()) {
    const settings = await context.guildSettings.get(guildId);
    selected = getSchedulePostFormat(settings.scheduleFormat);
  } else if (
    interaction.customId === ScheduleCustomId.FormatValue &&
    interaction.isStringSelectMenu()
  ) {
    selected = interaction.values.length === 1 ? interaction.values[0] : undefined;
  } else if (saving && interaction.isButton()) {
    selected = interaction.customId.slice(ScheduleCustomId.FormatSave.length + 1);
  } else {
    throw new CommandError(
      "Use Pick Format in /setup to choose a schedule format.",
      "schedule_format_control_invalid",
    );
  }

  const format = schedulePostFormatSchema.safeParse(selected);
  if (!format.success) {
    throw new CommandError(
      "Choose Plain or Expanded as the schedule format.",
      "schedule_format_invalid",
    );
  }

  if (saving) {
    const settings = await context.guildSettings.update(guildId, {
      scheduleFormat: format.data,
    });
    await interaction.editReply({
      ...buildSetupPanel(settings, "schedule", {
        scheduleState: context.guildScheduleStore?.get(guildId),
      }),
      content: null,
      embeds: [],
    });
    return;
  }

  const message = buildScheduleFormatPicker(format.data);
  await interaction.editReply({
    ...message,
    components: resolveV2MessageIcons(message, interaction.client).components ?? [],
    content: null,
    embeds: [],
  });
}
