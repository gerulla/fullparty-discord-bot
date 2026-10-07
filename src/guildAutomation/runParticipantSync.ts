import { PermissionFlagsBits } from "discord.js";
import { recordAdminAutomationRun } from "../admin/telemetryRecorder.js";
import { isExpectedDiscordFailure } from "../health/errorReporter.js";
import { recordFailureSafely, serializeFailureError } from "../health/failureReporter.js";
import { HttpError } from "../http/httpError.js";
import { getDiscordApiErrorCode, getErrorMessage } from "../lib/errors.js";
import { sendBotLogMessage } from "./messages.js";
import { updateMemberNickname } from "./nicknameSync.js";
import {
  runParticipantSyncEvent,
  type GuildRunParticipantSyncData,
  type ParticipantSyncStepResult,
  type RunParticipantSyncResult,
} from "./runParticipantSyncTypes.js";
import type { GuildAutomationProcessorOptions } from "./types.js";

export async function syncRunParticipant(
  options: GuildAutomationProcessorOptions,
  data: GuildRunParticipantSyncData,
): Promise<RunParticipantSyncResult> {
  const { context, client } = options;
  if (!context.guildRunRoles) {
    throw new HttpError(
      503,
      "run_role_store_not_configured",
      "Run role storage is unavailable.",
    );
  }
  const mapping = await context.guildRunRoles.get(data.discord_guild_id, data.run_id);
  if (mapping?.status !== "active") {
    throw new HttpError(
      409,
      "run_role_not_active",
      "This run has no active tracked role in this server.",
    );
  }

  const guild = await client.guilds.fetch(data.discord_guild_id);
  // Confirm the mapped role still exists on Discord; do not recreate it or use a template.
  const role = await guild.roles.fetch(mapping.roleId, { force: true });
  if (!role || role.id === guild.id || role.managed) {
    throw new HttpError(
      409,
      "run_role_unavailable",
      "The tracked run role is missing or cannot be assigned.",
    );
  }
  const member = await guild.members
    .fetch({ user: data.discord_user_id, force: true })
    .catch((error: unknown) => {
      if (getDiscordApiErrorCode(error) === "10007") {
        throw new HttpError(
          404,
          "guild_member_not_found",
          "The Discord user is not a member of this server.",
        );
      }
      throw error;
    });
  const bot = await guild.members.fetchMe({ force: true });
  const settings = await context.guildSettings.get(data.discord_guild_id);
  const reason = `FullParty participant sync for run ${String(data.run_id)}.`;

  const roleResult = await performSyncStep(options, data, "role_assignment", async () => {
    if (member.roles.cache.has(role.id)) return { status: "unchanged" };
    if (!bot.permissions.has(PermissionFlagsBits.ManageRoles)) {
      throw new HttpError(403, "bot_missing_manage_roles", "The bot needs Manage Roles.");
    }
    if (bot.roles.highest.comparePositionTo(role) <= 0) {
      throw new HttpError(
        403,
        "run_role_not_below_bot",
        "The run role must be below the bot's highest role.",
      );
    }
    await member.roles.add(role.id, reason);
    return { status: "updated" };
  });
  // Each operation has its own result: one Discord failure must not hide the other.
  const nicknameResult = await performSyncStep(
    options,
    data,
    "nickname_sync",
    async () => {
      if (!settings.syncDiscordNamesToFf14) {
        return { status: "skipped", message: "Nickname syncing is disabled in /setup." };
      }
      if (member.nickname === data.nickname) return { status: "unchanged" };
      if (!bot.permissions.has(PermissionFlagsBits.ManageNicknames)) {
        throw new HttpError(
          403,
          "bot_missing_manage_nicknames",
          "The bot needs Manage Nicknames.",
        );
      }
      if (!member.manageable) {
        throw new HttpError(
          403,
          "member_not_manageable",
          "The bot cannot change this member's nickname because of the Discord role hierarchy.",
        );
      }
      await updateMemberNickname(member, data.nickname, reason);
      return { status: "updated" };
    },
  );
  const steps = [roleResult, nicknameResult];
  const hasFailure = steps.some((step) => step.status === "failed");
  const hasSuccess = steps.some(
    (step) => step.status === "updated" || step.status === "unchanged",
  );
  const result: RunParticipantSyncResult = {
    discordGuildId: data.discord_guild_id,
    discordUserId: data.discord_user_id,
    runId: data.run_id,
    roleId: role.id,
    status: hasFailure ? (hasSuccess ? "partial" : "failed") : "completed",
    role: roleResult,
    nickname: nicknameResult,
  };
  context.logger.info("Run participant sync finished.", result);
  await sendBotLogMessage(
    options,
    settings.botLogChannelId,
    {
      content: [
        `FullParty Run #${String(data.run_id)} participant sync for <@${data.discord_user_id}>: ${result.status}.`,
        `Run role <@&${role.id}>: ${roleResult.status}.`,
        `Nickname: ${nicknameResult.status}.`,
      ].join("\n"),
      allowedMentions: { parse: [] },
    },
    { discordGuildId: data.discord_guild_id, messageType: "run_participant_sync" },
  );
  return result;
}

async function performSyncStep(
  options: GuildAutomationProcessorOptions,
  data: GuildRunParticipantSyncData,
  action: "role_assignment" | "nickname_sync",
  operation: () => Promise<ParticipantSyncStepResult>,
): Promise<ParticipantSyncStepResult> {
  const { context } = options;
  const startedAt = Date.now();
  let result: ParticipantSyncStepResult;
  try {
    result = await operation();
  } catch (error) {
    const expected = error instanceof HttpError || isExpectedDiscordFailure(error);
    const errorCode =
      error instanceof HttpError
        ? error.code
        : (getDiscordApiErrorCode(error) ?? "participant_sync_failed");
    result = { status: "failed", errorCode, message: getErrorMessage(error) };
    context.logger[expected ? "warn" : "error"]("Run participant sync step failed.", {
      action,
      discordGuildId: data.discord_guild_id,
      discordUserId: data.discord_user_id,
      runId: data.run_id,
      error,
    });
    recordFailureSafely(context.failureReporter, context.logger, {
      source: "guild_automation",
      action,
      affectsHealth: !expected,
      discordGuildId: data.discord_guild_id,
      discordUserId: data.discord_user_id,
      runId: data.run_id,
      eventType: runParticipantSyncEvent,
      errorCode,
      message: getErrorMessage(error),
      severity: expected ? "warn" : "error",
      details: { error: serializeFailureError(error) },
    });
  }
  recordAdminAutomationRun(context.adminStore, context.logger, {
    automationType: action,
    discordGuildId: data.discord_guild_id,
    eventType: runParticipantSyncEvent,
    runId: data.run_id,
    durationMs: Date.now() - startedAt,
    status:
      result.status === "failed"
        ? "failed"
        : result.status === "skipped" || result.status === "unchanged"
          ? "skipped"
          : "completed",
    successCount: result.status === "updated" ? 1 : 0,
    failureCount: result.status === "failed" ? 1 : 0,
    skippedCount: result.status === "skipped" || result.status === "unchanged" ? 1 : 0,
    result: { discordUserId: data.discord_user_id, ...result },
  });
  return result;
}
