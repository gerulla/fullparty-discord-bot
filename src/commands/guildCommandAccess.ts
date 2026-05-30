import {
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";

import type { BotContext } from "../bot/context.js";

export async function requireGuildBotModerator(
  interaction: ChatInputCommandInteraction,
  context: BotContext,
): Promise<boolean> {
  if (!interaction.inGuild() || !interaction.guildId) {
    await interaction.reply({
      content: "That command can only be used inside a Discord server.",
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  if (interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
    return true;
  }

  const settings = await context.guildSettings.get(interaction.guildId);

  if (
    settings.botModeratorRoleId &&
    memberHasRole(interaction.member, settings.botModeratorRoleId)
  ) {
    return true;
  }

  await interaction.reply({
    content: settings.botModeratorRoleId
      ? "You need Manage Server or the configured FullParty bot moderator role to use this command."
      : "You need Manage Server to use this command. A FullParty bot moderator role can be configured in `/setup`.",
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

function memberHasRole(member: unknown, roleId: string): boolean {
  if (!isRecord(member) || !("roles" in member)) {
    return false;
  }

  const roles = member.roles;

  if (Array.isArray(roles)) {
    return roles.includes(roleId);
  }

  if (!isRecord(roles)) {
    return false;
  }

  const cache = roles.cache;

  if (hasRoleIdLookup(cache)) {
    return cache.has(roleId);
  }

  if (hasRoleIdLookup(roles)) {
    return roles.has(roleId);
  }

  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasRoleIdLookup(value: unknown): value is { has(roleId: string): boolean } {
  return isRecord(value) && typeof value.has === "function";
}
