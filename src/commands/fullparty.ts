import {
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";

import type { FullpartyHealthResponse } from "../fullparty/client.js";
import type { ChatInputCommand } from "./types.js";

export const fullpartyCommand: ChatInputCommand = {
  data: new SlashCommandBuilder()
    .setName("fullparty")
    .setDescription("Manage Fullparty.gg from Discord.")
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    )
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("status").setDescription("Check the Fullparty API status."),
    ),
  async execute(interaction, context) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand !== "status") {
      await interaction.reply({
        content: "Unknown Fullparty command.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const health = await context.fullparty.health();

    await interaction.editReply(formatHealthResponse(health));
  },
};

export function formatHealthResponse(health: FullpartyHealthResponse): string {
  const status = typeof health.status === "string" ? health.status : "ok";
  const version = typeof health.version === "string" ? ` (${health.version})` : "";

  return `Fullparty API status: ${status}${version}`;
}
