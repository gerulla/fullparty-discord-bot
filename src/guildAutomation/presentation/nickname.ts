import type { APIEmbedField, MessageCreateOptions } from "discord.js";
import type { NicknameSyncResult } from "../results.js";
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
} from "./failures.js";

export function buildRunReminderNicknameSyncLogMessage(
  data: GuildRunReminderData,
  result: NicknameSyncResult,
): MessageCreateOptions {
  const failedUserCount = result.nicknameFailedUserCount;
  const requestedUserCount = result.nicknameRequestedUserCount;
  const skippedUserCount = result.nicknameSkippedUserCount;
  const syncedUserCount = result.nicknameSyncedUserCount;
  const skippedReason = result.nicknameSkippedReason;
  const failures = result.nicknameFailures ?? [];
  const status = getNicknameSyncStatus({
    failedUserCount,
    requestedUserCount,
    skippedReason,
    skippedUserCount,
    syncedUserCount,
  });
  const successfulUpdates = syncedUserCount + skippedUserCount;
  const fields: APIEmbedField[] = [
    {
      inline: true,
      name: "✅ Successful Updates",
      value: `${String(syncedUserCount)} ${formatPlural(syncedUserCount, "user")}\nupdated`,
    },
    {
      inline: true,
      name: "☑️ Already Correct",
      value: `${String(skippedUserCount)} ${formatPlural(skippedUserCount, "user")}\nunchanged`,
    },
    {
      inline: true,
      name: "❌ Failed Updates",
      value: `${String(failedUserCount)} ${formatPlural(failedUserCount, "user")}\nfailed`,
    },
    {
      inline: true,
      name: "📈 Success Rate",
      value: `${formatPercent(successfulUpdates, requestedUserCount)}\nhandled`,
    },
    {
      inline: true,
      name: "🔄 Update Mode",
      value: "Primary character\nName Surname [World]",
    },
  ];

  if (skippedReason) {
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
        "Some nickname updates failed. Common causes: user left the server, missing Manage Nicknames permission, role hierarchy, or Discord API limits.",
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
      sections: [createAutomationFailureSection("Nickname Sync Failures", failures)],
      title: "Nickname Sync Failure Details",
    }),
    fields,
    title: `🏷️ Nickname Synchronization - ${status.titleSuffix}`,
  });
}

type NicknameSyncStatusInput = {
  failedUserCount: number;
  requestedUserCount: number;
  skippedReason: string | undefined;
  skippedUserCount: number;
  syncedUserCount: number;
};

function getNicknameSyncStatus(input: NicknameSyncStatusInput): SyncStatus {
  if (input.skippedReason) {
    return { color: 0x64748b, titleSuffix: "Skipped" };
  }

  if (input.failedUserCount > 0 && input.syncedUserCount + input.skippedUserCount === 0) {
    return { color: 0xef4444, titleSuffix: "Failed" };
  }

  if (input.failedUserCount > 0) {
    return { color: 0xf59e0b, titleSuffix: "Partial" };
  }

  return { color: 0x22c55e, titleSuffix: "Complete" };
}
