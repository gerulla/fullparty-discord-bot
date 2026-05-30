export type GuildSettings = {
  botLogChannelId?: string;
  guildId: string;
  runAnnouncementChannelId?: string;
  syncDiscordNamesToFf14: boolean;
  upcomingRaiderRoleId?: string;
  updatedAt?: string;
};

export type GuildSettingsPatch = Partial<
  Pick<
    GuildSettings,
    | "botLogChannelId"
    | "runAnnouncementChannelId"
    | "syncDiscordNamesToFf14"
    | "upcomingRaiderRoleId"
  >
>;

export function createDefaultGuildSettings(guildId: string): GuildSettings {
  return {
    guildId,
    syncDiscordNamesToFf14: false,
  };
}
