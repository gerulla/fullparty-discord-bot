import type { ScheduleFormat, ScheduleMode } from "../guildSchedule/settings.js";

export type GuildSettings = {
  botLogChannelId?: string;
  botModeratorRoleId?: string;
  guildId: string;
  groupSlug?: string;
  linkedAt?: string;
  runRoleTemplateOverrides?: GuildRoleTemplateOverride[];
  runAnnouncementChannelId?: string;
  scheduleFormat?: ScheduleFormat;
  scheduleMode?: ScheduleMode;
  /** Compatibility alias: true for either automatic schedule mode. */
  scheduleRefreshEnabled?: boolean;
  /** Compatibility alias for runAnnouncementChannelId. */
  scheduleRefreshChannelId?: string;
  scheduleRefreshIntervalDays?: number;
  syncDiscordNamesToFf14: boolean;
  upcomingRaiderRoleId?: string;
  updatedAt?: string;
};

export type GuildRoleTemplateOverride = {
  activityId: number;
  activityName: string;
  createdAt?: string;
  roleId: string;
  updatedAt?: string;
};

export type GuildSettingsPatch = {
  botLogChannelId?: string | null;
  botModeratorRoleId?: string | null;
  groupSlug?: string | null;
  linkedAt?: string | null;
  runRoleTemplateOverrides?: GuildRoleTemplateOverride[];
  runAnnouncementChannelId?: string | null;
  scheduleFormat?: ScheduleFormat;
  scheduleMode?: ScheduleMode;
  scheduleRefreshEnabled?: boolean;
  scheduleRefreshChannelId?: string | null;
  scheduleRefreshIntervalDays?: number;
  syncDiscordNamesToFf14?: boolean;
  upcomingRaiderRoleId?: string | null;
};

export function createDefaultGuildSettings(guildId: string): GuildSettings {
  return {
    guildId,
    syncDiscordNamesToFf14: false,
  };
}
