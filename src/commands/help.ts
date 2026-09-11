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
    "`/link token:<code>` - Link your account in DMs, or this server using a group link code.",
    "`/runs` - Your upcoming runs. DM only; linked account required.",
    "`/applications` - Your applications. DM only; linked account required.",
    "`/faq` - Explain template roles, moderator access, and configured channels.",
    "`/info` - Browse resources. `/info name:<name>` searches privately or posts an exact match. All server members.",
    "`/setup` - Configure server channels, roles, and nickname sync. Requires Manage Server.",
    "**Server moderation** - These commands require Manage Server or the configured bot moderator role:",
    "`/guildruns` - Browse this server's upcoming runs.",
    "`/postruns` - Post the schedule in the Member-Facing Channel, or here with `posthere:true`.",
    "`/assignrunrole run_id:<id>` - Assign run roles from 60 minutes before to 15 minutes after start.",
    "`/debugassignrunrole run_id:<id>` - Check role eligibility for any run without changing roles.",
    "`/clearrole role:<role>` - Delete a stuck temporary run role.",
    "**Other commands**",
    "`/ping` - Quick bot responsiveness check.",
    "`/help` - Show this message.",
  ].join("\n");
}
