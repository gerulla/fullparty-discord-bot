import type { MessageCreateOptions } from "discord.js";
import type { NicknameSyncResult } from "../results.js";
import type { GuildRunReminderData } from "../runReminderTypes.js";
import type { SyncStatus } from "./common.js";
import { formatPlural, formatRunReminderSkippedReason } from "./common.js";
import {
  createAutomationFailureDetailsContext,
  createAutomationFailureDetailsId,
  createAutomationFailureSection,
} from "./failures.js";
import { createAutomationV2Message, createAutomationV2RunDescription } from "./v2.js";

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
  const statistics = [
    "### :fpcheck: Successful Updates",
    `> ${String(syncedUserCount)} ${formatPlural(syncedUserCount, "user")} updated`,
    !skippedReason && skippedUserCount > 0
      ? `> ${String(skippedUserCount)} already correct`
      : undefined,
    "### :fperrorx: Failed Updates",
    `> ${String(failedUserCount)} ${formatPlural(failedUserCount, "user")} failed`,
    "### :fpupdate: Update Mode",
    "> Primary character\n> Name Surname [World]",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
  const note = skippedReason
    ? `${formatRunReminderSkippedReason(skippedReason)} No nickname updates were attempted.`
    : failedUserCount > 0
      ? `${status.titleSuffix === "Failed" ? "No nicknames were updated. Check the failure details below." : "Some nickname updates failed."} Common causes: user left the server, missing Manage Nicknames permission, role hierarchy, or Discord API limits.`
      : requestedUserCount === 0
        ? "No nickname updates were needed."
        : `All ${String(requestedUserCount)} ${formatPlural(requestedUserCount, "user")} have the correct nickname. ${String(syncedUserCount)} ${syncedUserCount === 1 ? "was" : "were"} updated and ${String(skippedUserCount)} ${skippedUserCount === 1 ? "was" : "were"} already correct.`;

  return createAutomationV2Message({
    failureColor: status.color,
    description: createAutomationV2RunDescription(
      data,
      requestedUserCount,
      skippedReason,
    ),
    failureDetailsId: createAutomationFailureDetailsId({
      context: createAutomationFailureDetailsContext(data),
      sections: [createAutomationFailureSection("Nickname Sync Failures", failures)],
      title: "Nickname Sync Failure Details",
    }),
    failures,
    note,
    runUrl: data.run_url,
    statistics,
    title: `:fpnametag: Nickname Synchronization - ${status.titleSuffix === "Complete" ? "Success" : status.titleSuffix}`,
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
