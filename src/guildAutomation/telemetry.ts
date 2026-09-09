import type { AdminAutomationRunInput } from "@fullparty/admin";
import { recordAdminAutomationRun } from "../admin/telemetryRecorder.js";
import { recordFailureSafely } from "../health/failureReporter.js";
import type {
  RoleAssignmentResult,
  RoleCleanupResult,
  RunReminderResult,
} from "./results.js";
import type { GuildRunCompletedData, GuildRunReminderData } from "./runReminderTypes.js";
import type { GuildAutomationProcessorOptions } from "./types.js";

export function recordRunReminderAutomationTelemetry(
  options: GuildAutomationProcessorOptions,
  data: GuildRunReminderData,
  result: RunReminderResult,
): void {
  recordRoleAssignmentAutomationTelemetry(options, data, result);
  recordAdminAutomationRun(options.context.adminStore, options.context.logger, {
    automationType: "nickname_sync",
    discordGuildId: data.discord_guild_id,
    durationMs: result.nicknameProcessingTimeMs,
    eventType: data.type,
    failureCount: result.nicknameFailedUserCount,
    result,
    runId: data.run_id,
    skippedCount: result.nicknameSkippedUserCount,
    status: getAutomationStatus({
      failureCount: result.nicknameFailedUserCount,
      skippedReason: result.nicknameSkippedReason,
      successCount: result.nicknameSyncedUserCount,
    }),
    successCount: result.nicknameSyncedUserCount,
  });
}

export function recordRoleAssignmentAutomationTelemetry(
  options: GuildAutomationProcessorOptions,
  data: GuildRunReminderData,
  result: RoleAssignmentResult,
): void {
  const successCount = result.assignedUserCount;
  const failureCount = result.failedUserCount;

  recordAdminAutomationRun(options.context.adminStore, options.context.logger, {
    automationType: "role_assignment",
    discordGuildId: data.discord_guild_id,
    durationMs: result.roleProcessingTimeMs,
    eventType: data.type,
    failureCount,
    result,
    runId: data.run_id,
    skippedCount: result.skippedReason ? result.requestedUserCount : 0,
    status: getAutomationStatus({
      failureCount,
      skippedReason: result.skippedReason,
      successCount,
    }),
    successCount,
  });
}

export function recordCleanupAutomationTelemetry(
  options: GuildAutomationProcessorOptions,
  data: GuildRunCompletedData,
  result: RoleCleanupResult,
): void {
  const successCount = result.deletedRoleCount;
  const failureCount = result.failedRoleCount;

  recordAdminAutomationRun(options.context.adminStore, options.context.logger, {
    automationType: "role_cleanup",
    discordGuildId: data.discord_guild_id,
    eventType: data.type,
    failureCount,
    result,
    runId: data.run_id,
    skippedCount: result.skippedReason ? 1 : 0,
    status: getAutomationStatus({
      failureCount,
      skippedReason: result.skippedReason,
      successCount,
    }),
    successCount,
  });
}

function getAutomationStatus(input: {
  failureCount: number;
  skippedReason: string | undefined;
  successCount: number;
}): AdminAutomationRunInput["status"] {
  if (input.skippedReason) {
    return "skipped";
  }

  if (input.failureCount > 0 && input.successCount === 0) {
    return "failed";
  }

  if (input.failureCount > 0) {
    return "partial";
  }

  return "completed";
}

export function recordGuildAutomationIssue(
  options: GuildAutomationProcessorOptions,
  input: {
    action: string;
    data: GuildRunCompletedData | GuildRunReminderData;
    details?: unknown;
    errorCode: string | undefined;
    affectsHealth?: boolean | undefined;
    message: string;
    severity: "warn" | "error";
  },
): void {
  recordFailureSafely(options.context.failureReporter, options.context.logger, {
    action: input.action,
    affectsHealth: input.affectsHealth ?? true,
    details: input.details,
    discordGuildId: input.data.discord_guild_id,
    errorCode: input.errorCode,
    eventType: input.data.type,
    message: input.message,
    runId: input.data.run_id,
    severity: input.severity,
    source: "guild_automation",
  });
}

export function shouldRunRoleSkippedReasonAffectHealth(
  skippedReason: string | undefined,
): boolean {
  if (!skippedReason) {
    return true;
  }

  return !nonHealthRunRoleSkippedReasons.has(skippedReason);
}

const nonHealthRunRoleSkippedReasons = new Set([
  "bot_missing_manage_roles",
  "template_role_not_below_bot",
  "template_role_not_found",
  "upcoming_raider_role_not_configured",
]);
