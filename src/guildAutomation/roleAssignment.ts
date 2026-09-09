import type { GuildSettings } from "../guildSettings/types.js";
import { getErrorMessage } from "../lib/errors.js";
import {
  fetchGuildRole,
  fetchGuildRunReminderGuild,
  isRoleAssignableMember,
} from "./discordGateway.js";
import { sendBotLogMessage } from "./messages.js";
import {
  getRunReminderDiscordUserIds,
  getRunReminderPlacedUserCount,
} from "./participants.js";
import { formatRunReminderSkippedReason } from "./presentation/common.js";
import { buildRunReminderRoleSyncLogMessage } from "./presentation/role.js";
import type { RoleAssignmentContext, RoleAssignmentResult } from "./results.js";
import { getRunRolePreflightFailure } from "./rolePermissions.js";
import type { GuildRunReminderData } from "./runReminderTypes.js";
import { ensureRunRole, selectRunRoleTemplate } from "./runRoleManager.js";
import {
  recordGuildAutomationIssue,
  shouldRunRoleSkippedReasonAffectHealth,
} from "./telemetry.js";
import type {
  GuildAutomationProcessorOptions,
  RoleAssignmentProcessorOptions,
  RunReminderFailure,
} from "./types.js";

export async function assignUpcomingRaiderRole(
  options: GuildAutomationProcessorOptions,
  data: GuildRunReminderData,
  settings: GuildSettings,
  processorOptions: RoleAssignmentProcessorOptions = {},
): Promise<RoleAssignmentResult> {
  const discordUserIds = getRunReminderDiscordUserIds(data);
  const dryRun = processorOptions.dryRun === true;
  const requestedUserCount = getRunReminderPlacedUserCount(data);
  const unresolvedPlacedUserCount = Math.max(
    0,
    requestedUserCount - discordUserIds.length,
  );
  const templateSelection = selectRunRoleTemplate(settings, data);
  const baseResult: RoleAssignmentContext = {
    discordGuildId: data.discord_guild_id,
    reminderType: data.reminder_type,
    requestedUserCount,
    ...(dryRun ? { roleDryRun: true } : {}),
    runId: data.run_id,
    ...(templateSelection.overrideActivityId
      ? {
          templateOverrideActivityId: templateSelection.overrideActivityId,
          templateOverrideActivityName: templateSelection.overrideActivityName,
        }
      : {}),
    templateRoleSource: templateSelection.source,
    type: data.type,
  };

  if (!templateSelection.roleId) {
    const result = {
      ...baseResult,
      assignedUserCount: 0,
      failedUserCount: requestedUserCount,
      roleProcessingTimeMs: 0,
      skippedReason: "upcoming_raider_role_not_configured",
    };

    await sendBotLogMessage(
      options,
      settings.botLogChannelId,
      buildRunReminderRoleSyncLogMessage(data, result),
    );

    return result;
  }

  if (!dryRun && !options.context.guildRunRoles) {
    const result = {
      ...baseResult,
      assignedUserCount: 0,
      failedUserCount: requestedUserCount,
      roleProcessingTimeMs: 0,
      skippedReason: "run_role_store_not_configured",
      templateRoleId: templateSelection.roleId,
    };

    recordGuildAutomationIssue(options, {
      action: "run_role_assign",
      data,
      errorCode: "run_role_store_not_configured",
      message: "Run role database is not configured.",
      severity: "error",
    });
    await sendBotLogMessage(
      options,
      settings.botLogChannelId,
      buildRunReminderRoleSyncLogMessage(data, result),
    );

    return result;
  }

  if (discordUserIds.length === 0) {
    const result = {
      ...baseResult,
      assignedUserCount: 0,
      failedUserCount: requestedUserCount,
      roleProcessingTimeMs: 0,
      ...(requestedUserCount === 0 ? { skippedReason: "no_discord_users" } : {}),
      templateRoleId: templateSelection.roleId,
    };

    await sendBotLogMessage(
      options,
      settings.botLogChannelId,
      buildRunReminderRoleSyncLogMessage(data, result),
    );

    return result;
  }

  if (dryRun) {
    const result = await inspectUpcomingRaiderRoleAssignment(
      options,
      data,
      settings,
      baseResult,
    );

    await sendBotLogMessage(
      options,
      settings.botLogChannelId,
      buildRunReminderRoleSyncLogMessage(data, result),
    );

    return result;
  }

  const failures: { discordUserId: string; error: string }[] = [];
  const startedAt = Date.now();
  let assignedUserCount = 0;
  let copiedOverwriteCount = 0;
  let createdRunRole = false;
  let runRoleId: string | undefined;
  let runRoleName: string | undefined;
  let templateRoleId: string | undefined = templateSelection.roleId;

  try {
    const guild = await fetchGuildRunReminderGuild(options.client, data.discord_guild_id);
    const ensureRoleResult = await ensureRunRole(options, guild, data, settings);

    if (!ensureRoleResult.role) {
      const result = {
        ...baseResult,
        assignedUserCount: 0,
        failedUserCount: requestedUserCount,
        failures: ensureRoleResult.failures,
        roleProcessingTimeMs: Date.now() - startedAt,
        skippedReason: ensureRoleResult.skippedReason,
        templateRoleId: templateSelection.roleId,
      };

      recordGuildAutomationIssue(options, {
        affectsHealth: shouldRunRoleSkippedReasonAffectHealth(
          ensureRoleResult.skippedReason,
        ),
        action: "run_role_assign",
        data,
        details: result,
        errorCode: ensureRoleResult.skippedReason,
        message: formatRunReminderSkippedReason(
          ensureRoleResult.skippedReason ?? "run_role_assign_failed",
        ),
        severity: "warn",
      });
      await sendBotLogMessage(
        options,
        settings.botLogChannelId,
        buildRunReminderRoleSyncLogMessage(data, result),
      );

      return result;
    }

    copiedOverwriteCount = ensureRoleResult.copiedOverwriteCount;
    createdRunRole = ensureRoleResult.created;
    failures.push(...ensureRoleResult.failures);
    runRoleId = ensureRoleResult.role.id;
    runRoleName = ensureRoleResult.role.name;
    templateRoleId = ensureRoleResult.templateRole.id;

    for (const discordUserId of discordUserIds) {
      try {
        const member = await guild.members.fetch(discordUserId);

        if (!isRoleAssignableMember(member)) {
          throw new Error(`Discord member ${discordUserId} cannot receive roles.`);
        }

        await member.roles.add(
          ensureRoleResult.role.id,
          `FullParty ${data.reminder_type} run role for run ${String(data.run_id)}`,
        );
        assignedUserCount += 1;
      } catch (error) {
        failures.push({
          discordUserId,
          error: getErrorMessage(error),
        });
      }
    }
  } catch (error) {
    failures.push({
      discordUserId: "*",
      error: getErrorMessage(error),
    });
  }

  const result = {
    ...baseResult,
    assignedUserCount,
    copiedOverwriteCount,
    createdRunRole,
    failedUserCount: failures.length + unresolvedPlacedUserCount,
    failures,
    roleId: runRoleId,
    roleName: runRoleName,
    roleProcessingTimeMs: Date.now() - startedAt,
    templateRoleId,
  };

  if (result.failedUserCount > 0) {
    recordGuildAutomationIssue(options, {
      affectsHealth: false,
      action: "run_role_assign",
      data,
      details: result,
      errorCode: "run_role_assign_partial_failure",
      message: `${String(result.failedUserCount)} run role assignment issue(s) occurred.`,
      severity: assignedUserCount > 0 ? "warn" : "error",
    });
  }

  await sendBotLogMessage(
    options,
    settings.botLogChannelId,
    buildRunReminderRoleSyncLogMessage(data, result),
  );

  return result;
}

async function inspectUpcomingRaiderRoleAssignment(
  options: GuildAutomationProcessorOptions,
  data: GuildRunReminderData,
  settings: GuildSettings,
  baseResult: RoleAssignmentContext,
): Promise<RoleAssignmentResult> {
  const failures: RunReminderFailure[] = [];
  const startedAt = Date.now();
  let assignableUserCount = 0;
  const requestedUserCount =
    typeof baseResult.requestedUserCount === "number"
      ? baseResult.requestedUserCount
      : getRunReminderPlacedUserCount(data);
  const templateSelection = selectRunRoleTemplate(settings, data);
  let templateRoleId: string | undefined = templateSelection.roleId;

  try {
    const guild = await fetchGuildRunReminderGuild(options.client, data.discord_guild_id);
    const templateRole = templateSelection.roleId
      ? await fetchGuildRole(guild, templateSelection.roleId)
      : undefined;

    if (!templateSelection.roleId || !templateRole) {
      return {
        ...baseResult,
        assignedUserCount: 0,
        copiedOverwriteCount: 0,
        failedUserCount: requestedUserCount,
        roleProcessingTimeMs: Date.now() - startedAt,
        skippedReason: templateSelection.roleId
          ? "template_role_not_found"
          : "upcoming_raider_role_not_configured",
        templateRoleId: templateSelection.roleId,
      };
    }

    templateRoleId = templateRole.id;

    const preflightFailure = getRunRolePreflightFailure(guild, templateRole);

    if (preflightFailure) {
      return {
        ...baseResult,
        assignedUserCount: 0,
        copiedOverwriteCount: 0,
        failedUserCount: requestedUserCount,
        roleProcessingTimeMs: Date.now() - startedAt,
        skippedReason: preflightFailure,
        templateRoleId,
      };
    }

    for (const discordUserId of getRunReminderDiscordUserIds(data)) {
      try {
        const member = await guild.members.fetch(discordUserId);

        if (!isRoleAssignableMember(member)) {
          throw new Error(`Discord member ${discordUserId} cannot receive roles.`);
        }

        assignableUserCount += 1;
      } catch (error) {
        failures.push({
          discordUserId,
          error: getErrorMessage(error),
        });
      }
    }
  } catch (error) {
    failures.push({
      discordUserId: "*",
      error: getErrorMessage(error),
    });
  }

  return {
    ...baseResult,
    assignedUserCount: assignableUserCount,
    copiedOverwriteCount: 0,
    createdRunRole: false,
    failedUserCount: Math.max(failures.length, requestedUserCount - assignableUserCount),
    failures,
    roleProcessingTimeMs: Date.now() - startedAt,
    templateRoleId,
  };
}
