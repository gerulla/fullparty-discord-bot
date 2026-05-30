import {
  ApplicationIntegrationType,
  InteractionContextType,
  SlashCommandBuilder,
} from "discord.js";

import { createApplicationsMessage } from "../fullparty/discordUserMessages.js";
import { captureFullpartyCommandPayload } from "../fullparty/commandPayloadCapture.js";
import type { ChatInputCommand } from "./types.js";

export const applicationsCommand: ChatInputCommand = {
  data: new SlashCommandBuilder()
    .setName("applications")
    .setDescription("Show your FullParty applications.")
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    )
    .setContexts(InteractionContextType.BotDM, InteractionContextType.PrivateChannel),
  async execute(interaction, context) {
    await interaction.deferReply();

    const applications = await captureFullpartyCommandPayload({
      commandName: "applications",
      discordUserId: interaction.user.id,
      payloads: context.payloads,
      request: () => context.fullparty.getDiscordUserApplications(interaction.user.id),
    });

    await interaction.editReply(
      createApplicationsMessage(applications, context.fullpartyWebBaseUrl),
    );
  },
};
