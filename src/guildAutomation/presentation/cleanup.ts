import type { APIEmbedField, MessageCreateOptions } from "discord.js";
import type { RoleCleanupResult } from "../results.js";
import type { GuildRunCompletedData } from "../runReminderTypes.js";
import type { SyncStatus } from "./common.js";
import {
  createBotLogEmbedMessage,
  formatPlural,
  formatRunReminderSkippedReason,
} from "./common.js";
import {
  createAutomationFailureDetailsId,
  createAutomationFailureSection,
  createFailuresField,
  createRunCompletedFailureDetailsContext,
} from "./failures.js";

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
  const fields: APIEmbedField[] = [
    {
      inline: true,
      name: "🧹 Deleted Roles",
      value: `${String(deletedRoleCount)} ${formatPlural(deletedRoleCount, "role")}\ndeleted`,
    },
    {
      inline: true,
      name: "❌ Failed Deletes",
      value: `${String(failedRoleCount)} ${formatPlural(failedRoleCount, "role")}\nfailed`,
    },
    {
      inline: true,
      name: "🛡️ Run Role",
      value: roleId
        ? [`<@&${roleId}>`, roleName ? `\`${roleName}\`` : undefined]
            .filter((value): value is string => Boolean(value))
            .join("\n")
        : "_No active role_",
    },
  ];

  if (skippedReason) {
    fields.push({
      inline: false,
      name: "ℹ️ Note",
      value: formatRunReminderSkippedReason(skippedReason),
    });
  }

  const failureField = createFailuresField(failures);

  if (failureField) {
    fields.push(failureField);
  }

  return createBotLogEmbedMessage({
    color: status.color,
    description: createRunCompletedDescription(data),
    failureDetailsId: createAutomationFailureDetailsId({
      context: createRunCompletedFailureDetailsContext(data),
      sections: [createAutomationFailureSection("Run Role Cleanup Failures", failures)],
      title: "Run Role Cleanup Failure Details",
    }),
    fields,
    title: `🧹 Run Role Cleanup - ${status.titleSuffix}`,
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
  const icon = data.type === "runs.cancelled" ? "🚫" : "✅";

  return [
    `**Run #${String(data.run_id)}** • ${icon} **${status}**`,
    data.group_slug ? `**Group:** ${data.group_slug}` : undefined,
    "Cleaning up the temporary FullParty run role.",
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}
