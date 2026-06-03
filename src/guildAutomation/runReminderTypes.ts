import { z } from "zod";

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

export const guildRunReminderDataSchema = z.looseObject({
  activity_id: z.number().int().positive().optional(),
  activity_title: z.string().trim().min(1).optional(),
  activity: z.string().trim().min(1).optional(),
  discord_guild_id: z.string().trim().min(1),
  discord_user_ids: z.array(z.string().trim().min(1)).default([]),
  group_id: z.number().int().positive().optional(),
  group_slug: z.string().trim().min(1).optional(),
  participants: z.array(guildRunParticipantSchema).default([]),
  reminder_type: z.enum(["starting_soon", "starting_now"]),
  run_id: z.number().int().positive(),
  starts_at: z.string().trim().min(1).optional(),
  type: z.enum(["runs.starting_soon", "runs.starting_now"]),
  unlinked_participants: z.array(guildRunParticipantSchema).default([]),
});

export type GuildRunReminderData = z.infer<typeof guildRunReminderDataSchema>;

export const guildRunCompletedDataSchema = z.looseObject({
  activity_id: z.number().int().positive().optional(),
  activity_title: z.string().trim().min(1).optional(),
  activity: z.string().trim().min(1).optional(),
  discord_guild_id: z.string().trim().min(1),
  group_id: z.number().int().positive().optional(),
  group_slug: z.string().trim().min(1).optional(),
  participants: z.array(guildRunParticipantSchema).default([]),
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
