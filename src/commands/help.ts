import {
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

import type { ChatInputCommand } from "./types.js";
import { getDiscordAppInstallUrl } from "../fullparty/discordAppInstall.js";
import { hasGuildBotModeratorAccess } from "./guildCommandAccess.js";

type HelpAudience =
  | { kind: "dm" }
  | {
      kind: "guild";
      canManageServer: boolean;
      canModerate: boolean;
      canManageRoles: boolean;
    };

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
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: createHelpMessage(context.fullpartyWebBaseUrl),
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const canManageServer = interaction.memberPermissions.has(
      PermissionFlagsBits.ManageGuild,
    );
    const canManageRoles = interaction.memberPermissions.has(
      PermissionFlagsBits.ManageRoles,
    );
    let canModerate = hasGuildBotModeratorAccess(interaction);
    if (!canModerate && interaction.guildId) {
      const settings = await context.guildSettings.get(interaction.guildId);
      canModerate = hasGuildBotModeratorAccess(interaction, settings.botModeratorRoleId);
    }

    await interaction.editReply({
      content: createHelpMessage(context.fullpartyWebBaseUrl, {
        kind: "guild",
        canManageServer,
        canModerate,
        canManageRoles,
      }),
    });
  },
};

function createHelpMessage(
  fullpartyWebBaseUrl: string,
  audience: HelpAudience = { kind: "dm" },
): string {
  if (audience.kind === "dm") {
    return [
      "**FullParty Help · Direct Messages**",
      "",
      "**Account connection**",
      `Link your Discord account to view your runs and applications. Use \`/link\` or open ${getDiscordAppInstallUrl(fullpartyWebBaseUrl)} and follow the sign-in and authorization steps.`,
      "",
      "**DM commands**",
      "`/link` - Connect your FullParty account with automated setup or a link token.",
      "`/runs` - View your upcoming runs. Linked account required.",
      "`/applications` - View your applications. Linked account required.",
      ...commonCommands,
    ].join("\n");
  }

  const adminCommands = [
    ...(audience.canManageServer
      ? [
          "`/link token:<code>` - Link this server using a FullParty group link token.",
          "`/setup` - Configure channels, roles and nickname sync. Requires Manage Server.",
        ]
      : []),
    ...(audience.canModerate
      ? [
          "`/guildruns` - Browse this server's upcoming runs.",
          "`/postruns` - Post the schedule in the Schedule Channel, or here with `posthere:true`.",
          "`/assignrunrole run_id:<id>` - Assign run roles from 60 minutes before to 15 minutes after start.",
          "`/debugassignrunrole run_id:<id>` - Check role eligibility without changing roles.",
          "`/clearrole role:<role>` - Delete a stuck temporary run role.",
        ]
      : []),
    ...(audience.canManageRoles
      ? [
          "`/rolesync give-role-id:<role> to-users-with-role-id:<role>` - Copy role membership while keeping existing roles. Requires Manage Roles.",
        ]
      : []),
  ];

  return [
    "**FullParty Help · Server**",
    "",
    "**Member commands**",
    "`/info` - Browse this server's resources. `/info name:<name>` searches privately or posts an exact match. No personal account link required.",
    ...commonCommands,
    ...(adminCommands.length
      ? [
          "",
          "**Admin commands**",
          "Available with your server permissions or configured FullParty bot moderator role:",
          ...adminCommands,
        ]
      : []),
  ].join("\n");
}

const commonCommands = [
  "`/faq` - Learn about template roles, moderator access and configured channels.",
  "`/ping` - Check whether the bot is responsive.",
  "`/help` - Show commands available to you here.",
];
