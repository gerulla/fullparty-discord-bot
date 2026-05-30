import {
  ApplicationIntegrationType,
  InteractionContextType,
  SlashCommandBuilder,
} from "discord.js";

import { createUpcomingRunsMessage } from "../fullparty/discordUserMessages.js";
import { captureFullpartyCommandPayload } from "../fullparty/commandPayloadCapture.js";
import type { ChatInputCommand } from "./types.js";

export const runsCommand: ChatInputCommand = {
  data: new SlashCommandBuilder()
    .setName("runs")
    .setDescription("Show your upcoming FullParty runs.")
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    )
    .setContexts(InteractionContextType.BotDM, InteractionContextType.PrivateChannel),
  async execute(interaction, context) {
    await interaction.deferReply();

    const runs = await captureFullpartyCommandPayload({
      commandName: "runs",
      discordUserId: interaction.user.id,
      payloads: context.payloads,
      request: () => context.fullparty.getDiscordUserUpcomingRuns(interaction.user.id),
    });

    await interaction.editReply(
      createUpcomingRunsMessage(runs, context.fullpartyWebBaseUrl),
    );
  },
};
