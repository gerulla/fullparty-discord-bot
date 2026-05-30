import {
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";

import { createEventDebugMessages } from "../http/eventDebugMessages.js";
import type { ChatInputCommand } from "./types.js";

export const payloadCommand: ChatInputCommand = {
  data: new SlashCommandBuilder()
    .setName("payload")
    .setDescription("Show the most recent FullParty payload captured by the bot.")
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    )
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    ),
  async execute(interaction, context) {
    const latestPayload = context.payloads.get();

    if (!latestPayload) {
      await interaction.reply({
        content: "No FullParty payload has been captured yet.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const source = latestPayload.source ?? "FullParty payload";
    const messages = createEventDebugMessages(latestPayload.payload, source);

    await interaction.reply({
      content: `Most recent ${source} captured at ${latestPayload.receivedAt}.`,
      flags: MessageFlags.Ephemeral,
    });

    for (const message of messages) {
      await interaction.followUp({
        content: message.content ?? "",
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
