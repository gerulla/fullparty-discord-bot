export type GuildSettings = {
  botLogChannelId?: string;
  botModeratorRoleId?: string;
  guildId: string;
  linkedAt?: string;
  runAnnouncementChannelId?: string;
  syncDiscordNamesToFf14: boolean;
  upcomingRaiderRoleId?: string;
  updatedAt?: string;
};

export type GuildSettingsPatch = {
  botLogChannelId?: string | null;
  botModeratorRoleId?: string | null;
  linkedAt?: string | null;
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
