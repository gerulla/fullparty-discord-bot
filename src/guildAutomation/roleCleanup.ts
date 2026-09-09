import type { GuildSettings } from "../guildSettings/types.js";
import { getErrorMessage } from "../lib/errors.js";
import { fetchGuildRole, fetchGuildRunReminderGuild } from "./discordGateway.js";
import { sendBotLogMessage } from "./messages.js";
import { buildRunRoleCleanupLogMessage } from "./presentation/cleanup.js";
import type { RoleCleanupResult } from "./results.js";
import type { GuildRunCompletedData } from "./runReminderTypes.js";
import { recordGuildAutomationIssue } from "./telemetry.js";
import type { GuildAutomationProcessorOptions, RunReminderFailure } from "./types.js";

export async function deleteRunRole(
  options: GuildAutomationProcessorOptions,
  data: GuildRunCompletedData,
  settings: GuildSettings,
): Promise<RoleCleanupResult> {
  const baseResult: Pick<RoleCleanupResult, "discordGuildId" | "runId" | "type"> = {
    discordGuildId: data.discord_guild_id,
    runId: data.run_id,
    type: data.type,
  };

  if (!options.context.guildRunRoles) {
    const result = {
      ...baseResult,
      deletedRoleCount: 0,
      failedRoleCount: 0,
      skippedReason: "run_role_store_not_configured",
    };

    recordGuildAutomationIssue(options, {
      action: "run_role_cleanup",
      data,
      errorCode: "run_role_store_not_configured",
      message: "Run role database is not configured.",
      severity: "error",
    });
    await sendBotLogMessage(
      options,
      settings.botLogChannelId,
      buildRunRoleCleanupLogMessage(data, result),
    );

    return result;
  }

  const mapping = await options.context.guildRunRoles.get(
    data.discord_guild_id,
    data.run_id,
  );

  if (!mapping || mapping.status === "deleted") {
    const result = {
      ...baseResult,
      deletedRoleCount: 0,
      failedRoleCount: 0,
      skippedReason: "run_role_mapping_not_found",
    };

    await sendBotLogMessage(
      options,
      settings.botLogChannelId,
      buildRunRoleCleanupLogMessage(data, result),
    );

    return result;
  }

  const failures: RunReminderFailure[] = [];
  let deletedRoleCount = 0;

  try {
    const guild = await fetchGuildRunReminderGuild(options.client, data.discord_guild_id);
    const role = await fetchGuildRole(guild, mapping.roleId);

    if (role?.delete) {
      await role.delete(`FullParty run ${String(data.run_id)} ended.`);
      deletedRoleCount = 1;
    } else if (role) {
      failures.push({
        discordUserId: "*",
        error: `Discord role ${mapping.roleId} cannot be deleted by this bot.`,
      });
    }
  } catch (error) {
    failures.push({
      discordUserId: "*",
      error: getErrorMessage(error),
    });
  }

  if (failures.length === 0) {
    await options.context.guildRunRoles.markDeleted(data.discord_guild_id, data.run_id);
  }

  const result = {
    ...baseResult,
    deletedRoleCount,
    failedRoleCount: failures.length,
    failures,
    roleId: mapping.roleId,
    roleName: mapping.roleName,
  };

  if (failures.length > 0) {
    recordGuildAutomationIssue(options, {
      action: "run_role_cleanup",
      data,
      details: result,
      errorCode: "run_role_cleanup_failed",
      message: `${String(failures.length)} run role cleanup issue(s) occurred.`,
      severity: "error",
    });
  }

  await sendBotLogMessage(
    options,
    settings.botLogChannelId,
    buildRunRoleCleanupLogMessage(data, result),
  );

  return result;
}
