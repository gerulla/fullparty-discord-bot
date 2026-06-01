import {
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";

import type { ChatInputCommand } from "./types.js";

export const helpCommand: ChatInputCommand = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show FullParty Discord bot commands and linking requirements.")
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
    const isGuild = interaction.inGuild();

    await interaction.reply({
      content: createHelpMessage(context.fullpartyWebBaseUrl),
      ...(isGuild ? { flags: MessageFlags.Ephemeral } : {}),
    });
  },
};

function createHelpMessage(fullpartyWebBaseUrl: string): string {
  return [
    "**FullParty Discord Bot Help**",
    "",
    "**Connection requirement**",
    `Most FullParty commands need your Discord account linked first. Open ${fullpartyWebBaseUrl}, go to your user settings, generate a Discord link code, then run \`/link token:<code>\` in Discord.`,
    "Server setup also needs the Discord server linked from the FullParty group Discord linking flow.",
    "",
    "**Commands**",
    "`/link token:<code>` - Link your Discord account in DMs, or link a Discord server when used in that server with a group link token.",
    "`/runs` - Show your upcoming FullParty runs. DM only. Requires a linked FullParty account.",
    "`/applications` - Show your FullParty applications. DM only. Requires a linked FullParty account.",
    "`/faq` - Explain how the Template Role, Bot Moderator Role, and Member-Facing Channel work.",
    "`/setup` - Configure server channels, roles, moderator access, and sync preferences. Server only. Requires Manage Server.",
    "`/guildruns` - Show upcoming FullParty runs for this server. Server only. Requires Manage Server or the configured bot moderator role.",
    "`/assignrunrole run_id:<id>` - Manually assign the temporary run role for a run starting within 60 minutes, with a 15-minute grace period after start. Server only.",
    "`/clearrole role:<role>` - Delete a stuck temporary FullParty run role. Server only. Requires Manage Server or the configured bot moderator role.",
    "`/ping` - Quick bot responsiveness check.",
    "`/help` - Show this message.",
  ].join("\n");
}
