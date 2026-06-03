import {
  guildRunReminderDataSchema,
  type GuildRunReminderData,
} from "../guildAutomation/runReminderTypes.js";

type ExtractGuildRunReminderDataOptions = {
  discordGuildId: string;
  now?: Date | undefined;
  runId?: number | undefined;
};

export function extractGuildRunReminderData(
  response: unknown,
  options: ExtractGuildRunReminderDataOptions,
): GuildRunReminderData {
  const candidates = collectCandidates(response);

  for (const candidate of candidates) {
    if (!isRunLikeCandidate(candidate)) {
      continue;
    }

    const normalized = normalizeCandidate(candidate, options);
    const result = guildRunReminderDataSchema.safeParse(normalized);

    if (result.success) {
      return result.data;
    }
  }

  throw new Error("FullParty did not return a valid guild run role-assignment payload.");
}

function collectCandidates(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value)) {
    return [];
  }

  const candidates = [value];
  const nestedKeys = ["data", "payload", "response", "run", "activity"];

  for (const key of nestedKeys) {
    const nestedValue = value[key];

    if (isRecord(nestedValue)) {
      candidates.push(nestedValue);

      for (const nestedKey of nestedKeys) {
        const deeperValue = nestedValue[nestedKey];

        if (isRecord(deeperValue)) {
          candidates.push(deeperValue);
        }
      }
    }
  }

  if (value.event === "discord.guild.run_reminder" && isRecord(value.data)) {
    candidates.unshift(value.data);
  }

  return candidates;
}

function normalizeCandidate(
  candidate: Record<string, unknown>,
  options: ExtractGuildRunReminderDataOptions,
): Record<string, unknown> {
  const activity = isRecord(candidate.activity) ? candidate.activity : undefined;
  const run = isRecord(candidate.run) ? candidate.run : undefined;
  const group = isRecord(candidate.group) ? candidate.group : undefined;
  const discordGuild = isRecord(candidate.discord_guild)
    ? candidate.discord_guild
    : undefined;
  const startsAt =
    getString(candidate, "starts_at") ??
    getString(candidate, "start_at") ??
    getString(run, "starts_at") ??
    getString(run, "start_at") ??
    getString(activity, "starts_at") ??
    getString(activity, "start_at");
  const reminderType = getReminderType(candidate, startsAt, options.now ?? new Date());
  const type = getType(candidate, reminderType);

  return {
    ...candidate,
    activity_id:
      candidate.activity_id ?? getNumber(run, "activity_id") ?? getNumber(run, "id"),
    activity_title:
      candidate.activity_title ??
      getString(run, "activity_title") ??
      getString(run, "display_name") ??
      getString(run, "title") ??
      getString(run, "name") ??
      candidate.display_name ??
      candidate.title ??
      candidate.name ??
      getString(activity, "display_name") ??
      getString(activity, "title") ??
      getString(activity, "name") ??
      candidate.activity,
    discord_guild_id:
      candidate.discord_guild_id ??
      getString(discordGuild, "id") ??
      options.discordGuildId,
    group_id: candidate.group_id ?? getNumber(group, "id"),
    group_slug: candidate.group_slug ?? getString(group, "slug"),
    participants: normalizeParticipants(candidate.participants),
    reminder_type: reminderType,
    run_id:
      candidate.run_id ??
      candidate.id ??
      getNumber(run, "run_id") ??
      getNumber(run, "id") ??
      options.runId,
    starts_at: candidate.starts_at ?? candidate.start_at ?? startsAt,
    total_placed_count: candidate.total_placed_count,
    type,
    unlinked_count: candidate.unlinked_count,
    unlinked_participants: normalizeParticipants(candidate.unlinked_participants),
  };
}

function getReminderType(
  candidate: Record<string, unknown>,
  startsAt: string | undefined,
  now: Date,
): "starting_now" | "starting_soon" {
  if (candidate.reminder_type === "starting_now") {
    return "starting_now";
  }

  if (candidate.reminder_type === "starting_soon") {
    return "starting_soon";
  }

  if (candidate.type === "runs.starting_now") {
    return "starting_now";
  }

  if (candidate.type === "runs.starting_soon") {
    return "starting_soon";
  }

  const startsAtTime = startsAt ? Date.parse(startsAt) : Number.NaN;

  return !Number.isNaN(startsAtTime) && startsAtTime <= now.getTime()
    ? "starting_now"
    : "starting_soon";
}

function getType(
  candidate: Record<string, unknown>,
  reminderType: "starting_now" | "starting_soon",
): "runs.starting_now" | "runs.starting_soon" {
  if (candidate.type === "runs.starting_now" || candidate.type === "runs.starting_soon") {
    return candidate.type;
  }

  return reminderType === "starting_now" ? "runs.starting_now" : "runs.starting_soon";
}

function getString(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  if (!value) {
    return undefined;
  }

  const fieldValue = value[key];

  return typeof fieldValue === "string" && fieldValue.trim().length > 0
    ? fieldValue
    : undefined;
}

function getNumber(
  value: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  if (!value) {
    return undefined;
  }

  const fieldValue = value[key];

  return typeof fieldValue === "number" ? fieldValue : undefined;
}

function normalizeParticipants(value: unknown): unknown {
  if (!isUnknownArray(value)) {
    return value;
  }

  return value.map((participant) => {
    if (!isRecord(participant)) {
      return participant;
    }

    return {
      ...participant,
      primary_character: participant.primary_character ?? participant.character,
    };
  });
}

function isRunLikeCandidate(value: Record<string, unknown>): boolean {
  return [
    "activity_id",
    "activity_title",
    "discord_guild_id",
    "discord_user_ids",
    "display_name",
    "id",
    "participants",
    "reminder_type",
    "run",
    "run_id",
    "starts_at",
    "type",
    "unlinked_participants",
  ].some((key) => key in value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}
