import {
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";

import { recordFailureSafely, serializeFailureError } from "../health/failureReporter.js";
import { requireGuildBotModerator } from "./guildCommandAccess.js";
import type { ChatInputCommand } from "./types.js";

type ClearableRole = {
  comparePositionTo?(role: ClearableRole): number;
  delete(reason?: string): Promise<unknown>;
  editable?: boolean;
  id: string;
  managed?: boolean;
  name: string;
};

export const clearRoleCommand: ChatInputCommand = {
  data: new SlashCommandBuilder()
    .setName("clearrole")
    .setDescription("Delete a stuck FullParty run role.")
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .addRoleOption((option) =>
      option
        .setName("role")
        .setDescription("The temporary FullParty run role to delete.")
        .setRequired(true),
    ),
  async execute(interaction, context) {
    if (!(await requireGuildBotModerator(interaction, context))) {
      return;
    }

    const guildId = interaction.guildId;

    if (!guildId) {
      throw new Error("Expected clearrole interaction to include a guild id.");
    }

    if (!interaction.appPermissions.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.reply({
        content: "I need the Manage Roles permission before I can clear a run role.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const selectedRole = interaction.options.getRole("role", true);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const role = await fetchSelectedRole(interaction, selectedRole.id, selectedRole);

    if (!role) {
      await interaction.editReply({
        content: "I could not find that role in this server.",
      });
      return;
    }

    const blockedReason = getBlockedReason(interaction, role);

    if (blockedReason) {
      await interaction.editReply({
        content: blockedReason,
      });
      return;
    }

    try {
      await role.delete(
        `FullParty manual clearrole by Discord user ${interaction.user.id}.`,
      );
      await context.guildRunRoles?.markDeletedByRole?.(guildId, role.id);
    } catch (error) {
      recordFailureSafely(context.failureReporter, context.logger, {
        action: "clearrole",
        details: {
          error: serializeFailureError(error),
          roleId: role.id,
          roleName: role.name,
        },
        discordGuildId: guildId,
        discordUserId: interaction.user.id,
        errorCode: "discord_role_delete_failed",
        message: getErrorMessage(error),
        severity: "error",
        source: "discord_api",
      });
      await interaction.editReply({
        content: `I could not clear ${formatRoleName(role)}: ${getErrorMessage(error)}`,
      });
      return;
    }

    await interaction.editReply({
      content: `✅ Cleared ${formatRoleName(role)}. Discord will remove that role from all members automatically.`,
    });
  },
};

async function fetchSelectedRole(
  interaction: ChatInputCommandInteraction,
  roleId: string,
  selectedRole: unknown,
): Promise<ClearableRole | undefined> {
  const cachedRole = interaction.guild?.roles.cache.get(roleId);

  if (isClearableRole(cachedRole)) {
    return cachedRole;
  }

  const fetchedRole = await interaction.guild?.roles.fetch(roleId);

  if (isClearableRole(fetchedRole)) {
    return fetchedRole;
  }

  return isClearableRole(selectedRole) ? selectedRole : undefined;
}

function getBlockedReason(
  interaction: ChatInputCommandInteraction,
  role: ClearableRole,
): string | undefined {
  if (role.id === interaction.guildId) {
    return "I cannot delete the server's @everyone role.";
  }

  if (role.managed) {
    return `${formatRoleName(role)} is managed by Discord or another integration, so I cannot delete it.`;
  }

  const botHighestRole = interaction.guild?.members.me?.roles.highest;

  if (isComparableRole(botHighestRole) && botHighestRole.comparePositionTo(role) <= 0) {
    return `${formatRoleName(role)} is at or above my highest role. Move the bot role above it in Discord role settings, then try again.`;
  }

  if (role.editable === false) {
    return `${formatRoleName(role)} is not editable by the bot. Check Manage Roles and the Discord role hierarchy.`;
  }

  return undefined;
}

function isComparableRole(
  value: unknown,
): value is ClearableRole & { comparePositionTo(role: ClearableRole): number } {
  return isClearableRole(value) && typeof value.comparePositionTo === "function";
}

function isClearableRole(value: unknown): value is ClearableRole {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "name" in value &&
    "delete" in value &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.delete === "function"
  );
}

function formatRoleName(role: ClearableRole): string {
  return `\`${role.name}\``;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
