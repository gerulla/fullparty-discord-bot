import { z } from "zod";

export const runParticipantSyncEvent = "discord.guild.run_participant_sync";

export const guildRunParticipantSyncDataSchema = z.object({
  discord_guild_id: z.string().trim().min(1),
  discord_user_id: z.string().trim().min(1),
  nickname: z.string().trim().min(1).max(32),
  run_id: z.number().int().positive(),
});

export type GuildRunParticipantSyncData = z.infer<
  typeof guildRunParticipantSyncDataSchema
>;

export type ParticipantSyncStepResult = {
  status: "updated" | "unchanged" | "skipped" | "failed";
  errorCode?: string;
  message?: string;
};

export type RunParticipantSyncResult = {
  discordGuildId: string;
  discordUserId: string;
  runId: number;
  roleId: string;
  status: "completed" | "partial" | "failed";
  role: ParticipantSyncStepResult;
  nickname: ParticipantSyncStepResult;
};
