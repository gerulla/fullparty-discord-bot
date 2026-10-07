import { PermissionFlagsBits, type Guild } from "discord.js";
import type { BotContext } from "../bot/context.js";
import { CommandError } from "../commands/commandError.js";
import { isExpectedDiscordFailure } from "../health/errorReporter.js";
import { recordFailureSafely, serializeFailureError } from "../health/failureReporter.js";
import { getDiscordApiErrorCode, getErrorMessage } from "../lib/errors.js";

type RoleSyncOptions = {
  guild: Guild;
  giveRoleId: string;
  sourceRoleId: string;
  requestedByUserId: string;
  context: Pick<BotContext, "logger" | "failureReporter">;
};

export type RoleSyncResult = {
  matched: number;
  added: number;
  alreadyHadRole: number;
  failed: number;
};

export async function syncGuildRole({
  guild,
  giveRoleId,
  sourceRoleId,
  requestedByUserId,
  context,
}: RoleSyncOptions): Promise<RoleSyncResult> {
  if (giveRoleId === sourceRoleId) {
    throw new CommandError(
      "Choose two different roles: the role to give and the role members already have.",
      "rolesync_same_role",
    );
  }

  // Refresh all roles so hierarchy checks do not depend on a stale role cache.
  const roles = await guild.roles.fetch();
  const giveRole = roles.get(giveRoleId);
  if (!giveRole || !roles.has(sourceRoleId)) {
    throw new CommandError(
      "I could not find both selected roles in this server. Choose the roles again.",
      "rolesync_role_not_found",
    );
  }
  if (giveRole.id === guild.id || giveRole.managed) {
    throw new CommandError(
      "I cannot give the @everyone role or a role managed by Discord or an integration.",
      "rolesync_unassignable_role",
    );
  }

  const [requester, bot] = await Promise.all([
    guild.members.fetch({ user: requestedByUserId, force: true }),
    guild.members.fetchMe({ force: true }),
  ]);
  if (!requester.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new CommandError(
      "You need Manage Roles to use this command.",
      "rolesync_manage_roles_required",
    );
  }
  if (
    requestedByUserId !== guild.ownerId &&
    requester.roles.highest.comparePositionTo(giveRole) <= 0
  ) {
    throw new CommandError(
      "The role to give must be below your highest role.",
      "rolesync_requester_hierarchy",
    );
  }
  if (
    !bot.permissions.has(PermissionFlagsBits.ManageRoles) ||
    bot.roles.highest.comparePositionTo(giveRole) <= 0
  ) {
    throw new CommandError(
      "I need Manage Roles, and my highest role must be above the role to give.",
      "rolesync_bot_hierarchy",
    );
  }

  // Role.members only contains cached members. Fetch everyone, including offline users.
  const members = await guild.members.fetch().catch((error: unknown) => {
    throw new CommandError(
      "I could not fetch the full server member list, so no roles were changed. Check the bot's Server Members Intent and try again.",
      "rolesync_member_fetch_failed",
      true,
      { cause: error },
    );
  });
  const result: RoleSyncResult = { matched: 0, added: 0, alreadyHadRole: 0, failed: 0 };
  const reason = `FullParty /rolesync from role ${sourceRoleId} by Discord user ${requestedByUserId}.`;
  for (const member of members.values()) {
    if (sourceRoleId !== guild.id && !member.roles.cache.has(sourceRoleId)) continue;
    result.matched++;
    if (member.roles.cache.has(giveRoleId)) {
      result.alreadyHadRole++;
      continue;
    }
    try {
      // A single-role add uses Discord's idempotent PUT and preserves every other role.
      // Process serially; discord.js handles Discord's request rate limits.
      await member.roles.add(giveRoleId, reason);
      result.added++;
    } catch (error) {
      result.failed++;
      const expected = isExpectedDiscordFailure(error);
      context.logger[expected ? "warn" : "error"]("Role sync member update failed.", {
        discordGuildId: guild.id,
        discordUserId: member.id,
        giveRoleId,
        sourceRoleId,
        error,
      });
      recordFailureSafely(context.failureReporter, context.logger, {
        source: "discord_api",
        action: "rolesync",
        discordGuildId: guild.id,
        discordUserId: member.id,
        affectsHealth: !expected,
        severity: expected ? "warn" : "error",
        errorCode: getDiscordApiErrorCode(error) ?? "rolesync_assignment_failed",
        message: getErrorMessage(error),
        details: {
          giveRoleId,
          sourceRoleId,
          requestedByUserId,
          error: serializeFailureError(error),
        },
      });
    }
  }
  context.logger.info("Role sync finished.", {
    discordGuildId: guild.id,
    giveRoleId,
    sourceRoleId,
    requestedByUserId,
    ...result,
  });
  return result;
}
