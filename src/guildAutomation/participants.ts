import { getLooseNumber } from "../lib/valueReaders.js";
import type { GuildRunReminderData } from "./runReminderTypes.js";
import type { RunReminderFailure } from "./types.js";

export function getRunReminderPlacedUserCount(data: GuildRunReminderData): number {
  const totalPlacedCount = getLooseNumber(data, "total_placed_count");
  const discordUserCount = getRunReminderDiscordUserIds(data).length;
  const participantCount = data.participants.length + data.unlinked_participants.length;
  const unlinkedCount = getRunReminderUnlinkedPlacedUserCount(data);

  return Math.max(totalPlacedCount, participantCount, discordUserCount + unlinkedCount);
}

export function getRunReminderUnlinkedPlacedUserCount(
  data: GuildRunReminderData,
): number {
  return Math.max(
    getLooseNumber(data, "unlinked_count"),
    data.unlinked_participants.length,
    data.participants.filter((participant) => !participant.discord_user_id).length,
  );
}

export function createUnlinkedPlacedUserFailures(
  data: GuildRunReminderData,
): RunReminderFailure[] {
  const unlinkedCount = getRunReminderUnlinkedPlacedUserCount(data);

  if (unlinkedCount <= 0) {
    return [];
  }

  if (data.unlinked_participants.length > 0) {
    return data.unlinked_participants.map((participant) => ({
      discordUserId: formatParticipantCharacterLabel(participant) ?? "Unlinked user",
      error: "No Discord Account Linked",
    }));
  }

  return Array.from({ length: unlinkedCount }, (_, index) => ({
    discordUserId: `Unlinked user ${String(index + 1)}`,
    error: "No Discord Account Linked",
  }));
}

export function getRunReminderDiscordUserIds(data: GuildRunReminderData): string[] {
  return Array.from(
    new Set([
      ...data.discord_user_ids,
      ...data.participants.flatMap((participant) =>
        participant.discord_user_id ? [participant.discord_user_id] : [],
      ),
    ]),
  );
}

export function formatParticipantCharacterLabel(participant: {
  character?: { name: string; world: string } | undefined;
  primary_character?: { name: string; world: string } | undefined;
}): string | undefined {
  const character = getParticipantCharacter(participant);

  if (!character) {
    return undefined;
  }

  return `${character.name} [${character.world}]`;
}

export function getParticipantCharacter(participant: {
  character?: { name: string; world: string } | undefined;
  primary_character?: { name: string; world: string } | undefined;
}): { name: string; world: string } | undefined {
  return participant.primary_character ?? participant.character;
}
