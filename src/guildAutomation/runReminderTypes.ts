import { z } from "zod";

function isInputRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeParticipantInput(value: unknown): unknown {
  if (!isInputRecord(value)) {
    return undefined;
  }

  const participant = { ...value };

  if (participant.character === null) {
    delete participant.character;
  }

  if (participant.primary_character === null) {
    delete participant.primary_character;
  }

  if (participant.discord_user_id === "") {
    delete participant.discord_user_id;
  }

  return participant;
}

const guildRunParticipantSchema = z.looseObject({
  character: z
    .looseObject({
      name: z.string().trim().min(1),
      world: z.string().trim().min(1),
    })
    .optional(),
  discord_user_id: z.string().trim().min(1).nullable().optional(),
  group_role: z.string().trim().min(1).nullable().optional(),
  is_discord_linked: z.boolean().optional(),
  is_group_member: z.boolean().optional(),
  primary_character: z
    .looseObject({
      name: z.string().trim().min(1),
      world: z.string().trim().min(1),
    })
    .optional(),
  should_keep_group_role: z.boolean().optional(),
  source: z.string().trim().min(1).optional(),
  user_id: z.number().int().positive().optional(),
});

const guildRunParticipantsSchema = z
  .preprocess(
    (value) =>
      Array.isArray(value)
        ? value.flatMap((participant) => {
            const normalized = normalizeParticipantInput(participant);

            return normalized ? [normalized] : [];
          })
        : value,
    z.array(guildRunParticipantSchema).default([]),
  )
  .default([]);

export const guildRunReminderDataSchema = z.looseObject({
  activity_id: z.number().int().positive().optional(),
  activity_title: z.string().trim().min(1).optional(),
  activity: z.string().trim().min(1).optional(),
  discord_guild_id: z.string().trim().min(1),
  discord_user_ids: z.array(z.string().trim().min(1)).default([]),
  group_id: z.number().int().positive().optional(),
  group_slug: z.string().trim().min(1).optional(),
  participants: guildRunParticipantsSchema,
  reminder_type: z.enum(["starting_soon", "starting_now"]),
  run_id: z.number().int().positive(),
  starts_at: z.string().trim().min(1).optional(),
  type: z.enum(["runs.starting_soon", "runs.starting_now"]),
  unlinked_participants: guildRunParticipantsSchema,
});

export type GuildRunReminderData = z.infer<typeof guildRunReminderDataSchema>;

export const guildRunCompletedDataSchema = z.looseObject({
  activity_id: z.number().int().positive().optional(),
  activity_title: z.string().trim().min(1).optional(),
  activity: z.string().trim().min(1).optional(),
  discord_guild_id: z.string().trim().min(1),
  group_id: z.number().int().positive().optional(),
  group_slug: z.string().trim().min(1).optional(),
  participants: guildRunParticipantsSchema,
  run_id: z.number().int().positive(),
  type: z.enum(["runs.completed", "runs.cancelled"]).default("runs.completed"),
});

export type GuildRunCompletedData = z.infer<typeof guildRunCompletedDataSchema>;

export type GuildAutomationJobData =
  | {
      data: GuildRunReminderData;
      kind: "run_reminder";
    }
  | {
      data: GuildRunCompletedData;
      kind: "run_completed";
    };

export type GuildAutomationJobKind = GuildAutomationJobData["kind"];
