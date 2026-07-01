export type GuildSettings = {
  botLogChannelId?: string;
  botModeratorRoleId?: string;
  guildId: string;
  linkedAt?: string;
  runRoleTemplateOverrides?: GuildRoleTemplateOverride[];
  runAnnouncementChannelId?: string;
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
  linkedAt?: string | null;
  runRoleTemplateOverrides?: GuildRoleTemplateOverride[];
  runAnnouncementChannelId?: string | null;
  syncDiscordNamesToFf14?: boolean;
  upcomingRaiderRoleId?: string | null;
};

export function createDefaultGuildSettings(guildId: string): GuildSettings {
  return {
    guildId,
    syncDiscordNamesToFf14: false,
  };
}
