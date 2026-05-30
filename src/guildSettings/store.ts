import { openSqliteDatabase } from "../database/sqlite.js";
import {
  createDefaultGuildSettings,
  type GuildSettings,
  type GuildSettingsPatch,
} from "./types.js";

export type GuildSettingsStore = {
  get(guildId: string): Promise<GuildSettings>;
  update(guildId: string, patch: GuildSettingsPatch): Promise<GuildSettings>;
};

type GuildSettingsRow = {
  bot_log_channel_id: string | null;
  guild_id: string;
  run_announcement_channel_id: string | null;
  sync_discord_names_to_ff14: number;
  upcoming_raider_role_id: string | null;
  updated_at: string | null;
};

export class SqliteGuildSettingsStore implements GuildSettingsStore {
  private readonly database;

  public constructor(databasePath: string) {
    this.database = openSqliteDatabase(databasePath);
    this.initialize();
  }

  public get(guildId: string): Promise<GuildSettings> {
    const row = this.database
      .prepare(
        `
          SELECT
            bot_log_channel_id,
            guild_id,
            run_announcement_channel_id,
            sync_discord_names_to_ff14,
            upcoming_raider_role_id,
            updated_at
          FROM guild_settings
          WHERE guild_id = ?
        `,
      )
      .get(guildId) as GuildSettingsRow | undefined;

    return Promise.resolve(
      row ? rowToGuildSettings(row) : createDefaultGuildSettings(guildId),
    );
  }

  public async update(
    guildId: string,
    patch: GuildSettingsPatch,
  ): Promise<GuildSettings> {
    const current = await this.get(guildId);
    const next = mergeGuildSettingsPatch(guildId, current, patch);

    this.database
      .prepare(
        `
          INSERT INTO guild_settings (
            bot_log_channel_id,
            guild_id,
            run_announcement_channel_id,
            sync_discord_names_to_ff14,
            upcoming_raider_role_id,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(guild_id) DO UPDATE SET
            bot_log_channel_id = excluded.bot_log_channel_id,
            run_announcement_channel_id = excluded.run_announcement_channel_id,
            sync_discord_names_to_ff14 = excluded.sync_discord_names_to_ff14,
            upcoming_raider_role_id = excluded.upcoming_raider_role_id,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        next.botLogChannelId ?? null,
        next.guildId,
        next.runAnnouncementChannelId ?? null,
        next.syncDiscordNamesToFf14 ? 1 : 0,
        next.upcomingRaiderRoleId ?? null,
        next.updatedAt ?? null,
      );

    return next;
  }

  public close(): void {
    this.database.close();
  }

  private initialize(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id TEXT PRIMARY KEY,
        bot_log_channel_id TEXT,
        run_announcement_channel_id TEXT,
        upcoming_raider_role_id TEXT,
        sync_discord_names_to_ff14 INTEGER NOT NULL DEFAULT 0
          CHECK (sync_discord_names_to_ff14 IN (0, 1)),
        updated_at TEXT
      )
    `);
  }
}

function mergeGuildSettingsPatch(
  guildId: string,
  current: GuildSettings,
  patch: GuildSettingsPatch,
): GuildSettings {
  const next: GuildSettings = {
    guildId,
    syncDiscordNamesToFf14:
      patch.syncDiscordNamesToFf14 ?? current.syncDiscordNamesToFf14,
    updatedAt: new Date().toISOString(),
  };
  const botLogChannelId = patch.botLogChannelId ?? current.botLogChannelId;
  const runAnnouncementChannelId =
    patch.runAnnouncementChannelId ?? current.runAnnouncementChannelId;
  const upcomingRaiderRoleId = patch.upcomingRaiderRoleId ?? current.upcomingRaiderRoleId;

  if (botLogChannelId) {
    next.botLogChannelId = botLogChannelId;
  }

  if (runAnnouncementChannelId) {
    next.runAnnouncementChannelId = runAnnouncementChannelId;
  }

  if (upcomingRaiderRoleId) {
    next.upcomingRaiderRoleId = upcomingRaiderRoleId;
  }

  return next;
}

function rowToGuildSettings(row: GuildSettingsRow): GuildSettings {
  const settings: GuildSettings = {
    guildId: row.guild_id,
    syncDiscordNamesToFf14: row.sync_discord_names_to_ff14 === 1,
  };

  if (row.bot_log_channel_id) {
    settings.botLogChannelId = row.bot_log_channel_id;
  }

  if (row.run_announcement_channel_id) {
    settings.runAnnouncementChannelId = row.run_announcement_channel_id;
  }

  if (row.upcoming_raider_role_id) {
    settings.upcomingRaiderRoleId = row.upcoming_raider_role_id;
  }

  if (row.updated_at) {
    settings.updatedAt = row.updated_at;
  }

  return settings;
}
