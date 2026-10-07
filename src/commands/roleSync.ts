import {
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { syncGuildRole } from "../guildAutomation/roleSync.js";
import { CommandError } from "./commandError.js";
import type { ChatInputCommand } from "./types.js";

export const roleSyncCommand: ChatInputCommand = {
  data: new SlashCommandBuilder()
    .setName("rolesync")
    .setDescription("Give a role to every server member who has another role.")
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addRoleOption((option) =>
      option
        .setName("give-role-id")
        .setDescription("The role to add to matching members.")
        .setRequired(true),
    )
    .addRoleOption((option) =>
      option
        .setName("to-users-with-role-id")
        .setDescription("Members with this role will receive the role above.")
        .setRequired(true),
    ),
  async execute(interaction, context) {
    if (!interaction.inGuild() || !interaction.guild) {
      throw new CommandError(
        "That command can only be used inside a Discord server.",
        "rolesync_guild_required",
      );
    }
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageRoles)) {
      throw new CommandError(
        "You need Manage Roles to use this command.",
        "rolesync_manage_roles_required",
      );
    }
    if (!interaction.appPermissions.has(PermissionFlagsBits.ManageRoles)) {
      throw new CommandError(
        "I need Manage Roles before I can sync roles.",
        "rolesync_bot_permission",
      );
    }

    const giveRoleId = interaction.options.getRole("give-role-id", true).id;
    const sourceRoleId = interaction.options.getRole("to-users-with-role-id", true).id;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await syncGuildRole({
      guild: interaction.guild,
      giveRoleId,
      sourceRoleId,
      requestedByUserId: interaction.user.id,
      context,
    });
    await interaction.editReply({
      content: [
        `Role sync finished: <@&${sourceRoleId}> → <@&${giveRoleId}>.`,
        `Matched: ${String(result.matched)}. Added: ${String(result.added)}. Already had role: ${String(result.alreadyHadRole)}. Failed: ${String(result.failed)}.`,
        "The original role and all other roles were kept.",
        ...(result.failed
          ? [
              "Failures were recorded in the bot logs. You can rerun this command to try the remaining members again.",
            ]
          : []),
      ].join("\n"),
      allowedMentions: { parse: [] },
    });
  },
};
