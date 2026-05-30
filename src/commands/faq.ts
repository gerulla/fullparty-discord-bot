import {
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";

import type { ChatInputCommand } from "./types.js";

export const faqCommand: ChatInputCommand = {
  data: new SlashCommandBuilder()
    .setName("faq")
    .setDescription("Explain common FullParty Discord bot setup concepts.")
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    )
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    ),
  async execute(interaction) {
    const isGuild = interaction.inGuild();

    await interaction.reply({
      content: createFaqMessage(),
      ...(isGuild ? { flags: MessageFlags.Ephemeral } : {}),
    });
  },
};

export function createFaqMessage(): string {
  return [
    "**FullParty Bot FAQ**",
    "",
    "**Template Role**",
    "The Template Role is not the role users keep permanently. FullParty uses it as a blueprint when a run is starting.",
    "For each run, the bot creates a temporary run-specific role, copies the template role's permissions/channel access, assigns that temporary role to the run participants, then deletes it when the run completes or is cancelled.",
    "Place the bot's highest role above the Template Role, and make sure the bot has Manage Roles.",
    "",
    "**Bot Moderator Role**",
    "The Bot Moderator Role lets trusted server staff use operational bot commands without giving them Manage Server.",
    "Manage Server is still required to change `/setup` settings. The moderator role is for actions like clearing a stuck temporary run role with `/clearrole`.",
    "",
    "**Member-Facing Channel**",
    "This is the server channel FullParty can use for member-visible run messages later. Bot-log messages still go to the separate bot-log channel.",
  ].join("\n");
}
