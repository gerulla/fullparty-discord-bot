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
import { createAutomationV2Message, createAutomationV2RunDescription } from "./v2.js";

export function buildRunReminderRoleSyncLogMessage(
  data: GuildRunReminderData,
  result: RoleAssignmentResult,
): MessageCreateOptions {
  if (result.roleDryRun) {
    return buildLegacyRoleSyncLogMessage(data, result);
  }

  const { assignedUserCount, failedUserCount, requestedUserCount, skippedReason } =
    result;
  const status = getRoleSyncStatus({
    assignedUserCount,
    failedUserCount,
    requestedUserCount,
    skippedReason,
  });
  const failures = result.failures ?? [];
  const copiedOverwriteCount = result.copiedOverwriteCount ?? 0;
  const statistics = [
    "### :fpcheck: Assignment Completion",
    `> **${String(assignedUserCount)} / ${String(requestedUserCount)}** ${formatPlural(requestedUserCount, "user")} assigned`,
    skippedReason
      ? "> No assignments attempted"
      : failedUserCount > 0
        ? `> ${String(failedUserCount)} ${formatPlural(failedUserCount, "assignment")} failed`
        : undefined,
    "### :fpatsymbol: Template Role > Run Role",
    `> ${result.templateRoleId ? `<@&${result.templateRoleId}>` : "Not configured"} > ${result.roleId ? `<@&${result.roleId}>` : "Not created"}`,
    "### :fpnametag: Channel Access",
    `> ${copiedOverwriteCount > 0 ? `${String(copiedOverwriteCount)} ${formatPlural(copiedOverwriteCount, "overwrite")} copied` : "No overwrites copied"}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
  const note = skippedReason
    ? `${formatRunReminderSkippedReason(skippedReason)} No users were assigned.`
    : failedUserCount > 0
      ? `${status.titleSuffix === "Failed" ? `${result.roleId ? "The run role is ready, but no users could be assigned." : "No users could be assigned a run role."} Check the failure details.` : "Some role assignments failed."} Common causes: user left the server, missing bot permissions, role hierarchy, or Discord API limits.`
      : `${requestedUserCount > 0 ? `All ${String(assignedUserCount)} ${formatPlural(assignedUserCount, "user")} ${assignedUserCount === 1 ? "was" : "were"} assigned the run role.` : "No users required role assignment."}${result.roleId ? (result.createdRunRole ? " A new role was created for this run." : " The existing run role was reused.") : ""}`;

  return createAutomationV2Message({
    description: createAutomationV2RunDescription(
      data,
      requestedUserCount,
      skippedReason,
    ),
    failureColor: status.color,
    failureDetailsId: createAutomationFailureDetailsId({
      context: createAutomationFailureDetailsContext(data),
      sections: [
        createAutomationFailureSection("Role Assignment Failures", failures),
        createUnlinkedPlacedUsersSection(
          data,
          getRunReminderUnlinkedPlacedUserCount(data),
        ),
      ],
      title: "Role Assignment Failure Details",
    }),
    failures,
    note,
    runUrl: data.run_url,
    statistics,
    title: `:fpatsymbol: Role Assignment - ${status.titleSuffix === "Complete" ? "Success" : status.titleSuffix}`,
  });
}

// Dry-run logs have no approved V2 design yet.
function buildLegacyRoleSyncLogMessage(
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
