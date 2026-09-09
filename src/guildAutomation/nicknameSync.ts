import type { GuildSettings } from "../guildSettings/types.js";
import { getErrorMessage } from "../lib/errors.js";
import {
  fetchGuildRunReminderGuild,
  getCurrentNickname,
  isNicknameSyncableMember,
} from "./discordGateway.js";
import { sendBotLogMessage } from "./messages.js";
import {
  createUnlinkedPlacedUserFailures,
  formatParticipantCharacterLabel,
  getParticipantCharacter,
  getRunReminderPlacedUserCount,
} from "./participants.js";
import { buildRunReminderNicknameSyncLogMessage } from "./presentation/nickname.js";
import type { NicknameSyncResult } from "./results.js";
import type { GuildRunReminderData } from "./runReminderTypes.js";
import { recordGuildAutomationIssue } from "./telemetry.js";
import type { GuildAutomationProcessorOptions, RunReminderFailure } from "./types.js";

const discordNicknameLimit = 32;

export async function syncRunReminderNicknames(
  options: GuildAutomationProcessorOptions,
  data: GuildRunReminderData,
  settings: GuildSettings,
): Promise<NicknameSyncResult> {
  const targets = getRunReminderNicknameTargets(data);
  const requestedUserCount = getRunReminderPlacedUserCount(data);
  const missingTargetCount = Math.max(0, requestedUserCount - targets.length);
  const baseResult = {
    nicknameRequestedUserCount: requestedUserCount,
    nicknameSyncEnabled: settings.syncDiscordNamesToFf14,
  };

  if (!settings.syncDiscordNamesToFf14) {
    return {
      ...baseResult,
      nicknameFailedUserCount: 0,
      nicknameSkippedReason: "nickname_sync_disabled",
      nicknameSkippedUserCount: requestedUserCount,
      nicknameSyncedUserCount: 0,
    };
  }

  if (targets.length === 0) {
    const failures = createNicknamePreparationFailures(data, targets, missingTargetCount);
    const result = {
      ...baseResult,
      nicknameFailedUserCount: requestedUserCount,
      nicknameFailures: failures,
      nicknameProcessingTimeMs: 0,
      ...(requestedUserCount === 0
        ? { nicknameSkippedReason: "no_nickname_targets" }
        : {}),
      nicknameSkippedUserCount: 0,
      nicknameSyncedUserCount: 0,
    };

    await sendBotLogMessage(
      options,
      settings.botLogChannelId,
      buildRunReminderNicknameSyncLogMessage(data, result),
    );

    return result;
  }

  const failures: { discordUserId: string; error: string }[] =
    createNicknamePreparationFailures(data, targets, missingTargetCount);
  const startedAt = Date.now();
  let skippedUserCount = 0;
  let syncedUserCount = 0;

  try {
    const guild = await fetchGuildRunReminderGuild(options.client, data.discord_guild_id);

    for (const target of targets) {
      try {
        const member = await guild.members.fetch(target.discordUserId);
        const currentNickname = getCurrentNickname(member);

        if (currentNickname === target.nickname) {
          skippedUserCount += 1;
          continue;
        }

        if (!isNicknameSyncableMember(member)) {
          throw new Error(
            `Discord member ${target.discordUserId} cannot have nicknames managed.`,
          );
        }

        await member.setNickname(
          target.nickname,
          `FullParty ${data.reminder_type} nickname sync for run ${String(data.run_id)}`,
        );
        syncedUserCount += 1;
      } catch (error) {
        failures.push({
          discordUserId: target.discordUserId,
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

  const unaccountedFailureCount = Math.max(
    0,
    requestedUserCount - syncedUserCount - skippedUserCount - failures.length,
  );

  for (let index = 0; index < unaccountedFailureCount; index += 1) {
    failures.push({
      discordUserId: `Unresolved roster user ${String(index + 1)}`,
      error: "The bot could not prepare a nickname update for this roster user.",
    });
  }

  const result = {
    ...baseResult,
    nicknameFailedUserCount: failures.length,
    nicknameFailures: failures,
    nicknameProcessingTimeMs: Date.now() - startedAt,
    nicknameSkippedUserCount: skippedUserCount,
    nicknameSyncedUserCount: syncedUserCount,
  };

  if (result.nicknameFailedUserCount > 0) {
    recordGuildAutomationIssue(options, {
      affectsHealth: false,
      action: "nickname_sync",
      data,
      details: result,
      errorCode: "nickname_sync_partial_failure",
      message: `${String(result.nicknameFailedUserCount)} nickname sync issue(s) occurred.`,
      severity: syncedUserCount > 0 || skippedUserCount > 0 ? "warn" : "error",
    });
  }

  await sendBotLogMessage(
    options,
    settings.botLogChannelId,
    buildRunReminderNicknameSyncLogMessage(data, result),
  );

  return result;
}

type NicknameSyncTarget = {
  discordUserId: string;
  nickname: string;
};

function getRunReminderNicknameTargets(data: GuildRunReminderData): NicknameSyncTarget[] {
  const targetsByUserId = new Map<string, NicknameSyncTarget>();

  for (const participant of data.participants) {
    const character = getParticipantCharacter(participant);

    if (!participant.discord_user_id || !character) {
      continue;
    }

    const nickname = formatCharacterNickname(character);

    if (!nickname) {
      continue;
    }

    targetsByUserId.set(participant.discord_user_id, {
      discordUserId: participant.discord_user_id,
      nickname,
    });
  }

  return [...targetsByUserId.values()];
}

function createNicknamePreparationFailures(
  data: GuildRunReminderData,
  targets: NicknameSyncTarget[],
  missingTargetCount: number,
): RunReminderFailure[] {
  if (missingTargetCount <= 0) {
    return [];
  }

  const targetUserIds = new Set(targets.map((target) => target.discordUserId));
  const failures = createUnlinkedPlacedUserFailures(data);

  for (const participant of data.participants) {
    if (!participant.discord_user_id || targetUserIds.has(participant.discord_user_id)) {
      continue;
    }

    failures.push({
      discordUserId:
        formatParticipantCharacterLabel(participant) ?? participant.discord_user_id,
      error: "No primary character included for nickname sync.",
    });
  }

  const placeholderCount = Math.max(0, missingTargetCount - failures.length);

  for (let index = 0; index < placeholderCount; index += 1) {
    failures.push({
      discordUserId: `Unresolved roster user ${String(index + 1)}`,
      error: "The bot could not prepare a nickname update for this roster user.",
    });
  }

  return failures.slice(0, missingTargetCount);
}

function formatCharacterNickname(character: {
  name: string;
  world: string;
}): string | undefined {
  const name = character.name.trim();
  const world = character.world.trim();

  if (!name || !world) {
    return undefined;
  }

  const suffix = ` [${world}]`;
  const fullNickname = `${name}${suffix}`;

  if (fullNickname.length <= discordNicknameLimit) {
    return fullNickname;
  }

  const maxNameLength = discordNicknameLimit - suffix.length;

  if (maxNameLength <= 0) {
    return fullNickname.slice(0, discordNicknameLimit).trim();
  }

  return `${name.slice(0, maxNameLength).trim()}${suffix}`;
}
