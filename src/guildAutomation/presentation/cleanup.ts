import type { MessageCreateOptions } from "discord.js";
import type { RoleCleanupResult } from "../results.js";
import type { GuildRunCompletedData } from "../runReminderTypes.js";
import type { SyncStatus } from "./common.js";
import { formatRunReminderSkippedReason, truncateText } from "./common.js";
import {
  createAutomationFailureDetailsId,
  createAutomationFailureSection,
  createRunCompletedFailureDetailsContext,
} from "./failures.js";
import { createAutomationV2Message } from "./v2.js";

export function buildRunRoleCleanupLogMessage(
  data: GuildRunCompletedData,
  result: RoleCleanupResult,
): MessageCreateOptions {
  const deletedRoleCount = result.deletedRoleCount;
  const failedRoleCount = result.failedRoleCount;
  const roleId = result.roleId;
  const roleName = result.roleName;
  const skippedReason = result.skippedReason;
  const failures = result.failures ?? [];
  const status = getCleanupStatus({ deletedRoleCount, failedRoleCount, skippedReason });
  // Deleted roles cannot resolve as Discord mentions, so retain their name and ID.
  const roleDetails = roleId
    ? [
        failedRoleCount > 0 ? `> <@&${roleId}>` : undefined,
        roleName ? `> \`${truncateText(roleName, 256)}\`` : undefined,
        failedRoleCount === 0 ? `> ID: \`${roleId}\`` : undefined,
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n")
    : "> No active run role mapped";
  const note = skippedReason
    ? `${formatRunReminderSkippedReason(skippedReason)} No role deletion was attempted.`
    : failedRoleCount > 0
      ? "The temporary run role could not be deleted. Check the failure details below, the bot's Manage Roles permission, and whether the run role is below the bot's highest role."
      : deletedRoleCount > 0
        ? `The temporary run role was deleted after this run was ${data.type === "runs.cancelled" ? "cancelled" : "completed"}.`
        : "The temporary run role was already absent from Discord. Its stored mapping has been cleared.";

  return createAutomationV2Message({
    failureColor: status.color,
    description: createRunCompletedDescription(data),
    failureDetailsId: createAutomationFailureDetailsId({
      context: createRunCompletedFailureDetailsContext(data),
      sections: [createAutomationFailureSection("Run Role Cleanup Failures", failures)],
      title: "Run Role Cleanup Failure Details",
    }),
    failures,
    note,
    runUrl: data.run_url,
    statistics: `### :fpatsymbol: Run Role\n${roleDetails}`,
    title: `:fpatsymbol: Run Role Cleanup - ${status.titleSuffix === "Complete" ? "Success" : status.titleSuffix}`,
  });
}

type CleanupStatusInput = {
  deletedRoleCount: number;
  failedRoleCount: number;
  skippedReason: string | undefined;
};

function getCleanupStatus(input: CleanupStatusInput): SyncStatus {
  if (input.skippedReason) {
    return { color: 0x64748b, titleSuffix: "Skipped" };
  }

  if (input.failedRoleCount > 0) {
    return { color: 0xef4444, titleSuffix: "Failed" };
  }

  return { color: 0x22c55e, titleSuffix: "Complete" };
}

function createRunCompletedDescription(data: GuildRunCompletedData): string {
  const status = data.type === "runs.cancelled" ? "Cancelled" : "Completed";

  return [
    `**Run #${String(data.run_id)}** • ${status}`,
    data.group_slug ? `**Group:** ${truncateText(data.group_slug, 256)}` : undefined,
    "Cleaning up the temporary FullParty run role.",
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}
