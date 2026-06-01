import {
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";

import { captureFullpartyCommandPayload } from "../fullparty/commandPayloadCapture.js";
import { createGuildUpcomingRunsMessage } from "../fullparty/discordGuildMessages.js";
import { requireGuildBotModerator } from "./guildCommandAccess.js";
import type { ChatInputCommand } from "./types.js";

export const guildRunsCommand: ChatInputCommand = {
  data: new SlashCommandBuilder()
    .setName("guildruns")
    .setDescription("Show upcoming FullParty runs for this Discord server.")
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription("How many upcoming runs to fetch from FullParty.")
        .setMinValue(1)
        .setMaxValue(100),
    ),
  async execute(interaction, context) {
    if (!(await requireGuildBotModerator(interaction, context))) {
      return;
    }

    const guildId = interaction.guildId;

    if (!guildId) {
      throw new Error("Expected guildruns interaction to include a guild id.");
    }

    const settings = await context.guildSettings.get(guildId);

    if (!settings.linkedAt) {
      await interaction.reply({
        content:
          "This Discord server is not linked to a FullParty group yet. Use `/link token:<code>` with a server link token from FullParty first.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const limit = interaction.options.getInteger("limit") ?? 25;
    const runs = await captureFullpartyCommandPayload({
      commandName: "guildruns",
      discordGuildId: guildId,
      payloads: context.payloads,
      request: () => context.fullparty.getDiscordGuildUpcomingRuns(guildId, { limit }),
    });

    await interaction.editReply(
      createGuildUpcomingRunsMessage(runs, context.fullpartyWebBaseUrl),
    );
  },
};
