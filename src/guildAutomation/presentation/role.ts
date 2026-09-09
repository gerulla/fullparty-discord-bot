import type { APIEmbedField, MessageCreateOptions } from "discord.js";
import { getRunReminderUnlinkedPlacedUserCount } from "../participants.js";
import type { RoleAssignmentResult } from "../results.js";
import type { GuildRunReminderData } from "../runReminderTypes.js";
import type { SyncStatus } from "./common.js";
import {
  createBotLogEmbedMessage,
  createRunReminderDescription,
  formatPercent,
  formatPlural,
  formatRunReminderSkippedReason,
} from "./common.js";
import {
  createAutomationFailureDetailsContext,
  createAutomationFailureDetailsId,
  createAutomationFailureSection,
  createFailuresField,
  createUnlinkedPlacedUsersSection,
} from "./failures.js";

export function buildRunReminderRoleSyncLogMessage(
  data: GuildRunReminderData,
  result: RoleAssignmentResult,
): MessageCreateOptions {
  const assignedUserCount = result.assignedUserCount;
  const failedUserCount = result.failedUserCount;
  const requestedUserCount = result.requestedUserCount;
  const copiedOverwriteCount = result.copiedOverwriteCount ?? 0;
  const createdRunRole = result.createdRunRole === true;
  const dryRun = result.roleDryRun === true;
  const roleId = result.roleId;
  const roleName = result.roleName;
  const skippedReason = result.skippedReason;
  const templateRoleId = result.templateRoleId;
  const failures = result.failures ?? [];
  const unlinkedCount = getRunReminderUnlinkedPlacedUserCount(data);
  const status = getRoleSyncStatus({
    assignedUserCount,
    failedUserCount,
    requestedUserCount,
    skippedReason,
  });
  const successfulAssignments = assignedUserCount;
  const fields: APIEmbedField[] = [
    {
      inline: true,
      name: dryRun ? "✅ Eligible Assignments" : "✅ Successful Assignments",
      value: `${String(successfulAssignments)} ${formatPlural(successfulAssignments, "user")}\n${dryRun ? "would assign" : "assigned"}`,
    },
    {
      inline: true,
      name: dryRun ? "❌ Failed Checks" : "❌ Failed Assignments",
      value: `${String(failedUserCount)} ${formatPlural(failedUserCount, "user")}\nfailed`,
    },
    {
      inline: true,
      name: "📈 Success Rate",
      value: `${formatPercent(successfulAssignments, requestedUserCount)}\n${dryRun ? "check rate" : "assignment rate"}`,
    },
    {
      inline: true,
      name: "🛡️ Run Role",
      value: roleId
        ? [`<@&${roleId}>`, roleName ? `\`${roleName}\`` : undefined]
            .filter((value): value is string => Boolean(value))
            .join("\n")
        : dryRun
          ? "_Dry run only_"
          : "_Not created_",
    },
    {
      inline: true,
      name: "📋 Template",
      value: templateRoleId ? `<@&${templateRoleId}>` : "_Not configured_",
    },
    {
      inline: true,
      name: "🔐 Channel Access",
      value: dryRun
        ? "Not copied\ndry run"
        : `${String(copiedOverwriteCount)} ${formatPlural(copiedOverwriteCount, "overwrite")}\ncopied`,
    },
    {
      inline: true,
      name: "✨ Role State",
      value: dryRun
        ? "Not created (dry run)"
        : skippedReason
          ? "Not created"
          : createdRunRole
            ? "Created for this run"
            : "Reused for this run",
    },
  ];

  if (dryRun) {
    fields.push({
      inline: false,
      name: "ℹ️ Note",
      value:
        "Dry run only. No roles were created, channel overwrites copied, or members assigned.",
    });
  } else if (skippedReason) {
    fields.push({
      inline: false,
      name: "ℹ️ Note",
      value: formatRunReminderSkippedReason(skippedReason),
    });
  } else if (failedUserCount > 0) {
    fields.push({
      inline: false,
      name: "ℹ️ Note",
      value:
        "Some role assignments failed. Common causes: user left the server, missing bot permissions, role hierarchy, or Discord API limits.",
    });
  }

  const failureField = createFailuresField(failures);

  if (failureField) {
    fields.push(failureField);
  }

  return createBotLogEmbedMessage({
    color: status.color,
    description: createRunReminderDescription(data, requestedUserCount, skippedReason),
    failureDetailsId: createAutomationFailureDetailsId({
      context: createAutomationFailureDetailsContext(data),
      sections: [
        createAutomationFailureSection("Role Assignment Failures", failures),
        createUnlinkedPlacedUsersSection(data, unlinkedCount),
      ],
      title: "Role Assignment Failure Details",
    }),
    fields,
    title: `${dryRun ? "🧪 Role Assignment Dry Run" : "🛡️ Role Assignment"} - ${status.titleSuffix}`,
  });
}

type RoleSyncStatusInput = {
  assignedUserCount: number;
  failedUserCount: number;
  requestedUserCount: number;
  skippedReason: string | undefined;
};

function getRoleSyncStatus(input: RoleSyncStatusInput): SyncStatus {
  if (input.skippedReason) {
    return { color: 0x64748b, titleSuffix: "Skipped" };
  }

  if (input.failedUserCount > 0 && input.assignedUserCount === 0) {
    return { color: 0xef4444, titleSuffix: "Failed" };
  }

  if (input.failedUserCount > 0) {
    return { color: 0xf59e0b, titleSuffix: "Partial" };
  }

  return { color: 0x22c55e, titleSuffix: "Complete" };
}
