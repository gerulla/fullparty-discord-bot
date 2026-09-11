import { openSqliteDatabase } from "../database/sqlite.js";
import { readScheduleSettings, writeScheduleSettings } from "../guildSchedule/store.js";
import { scheduleIntervalDaysSchema } from "../guildSchedule/settings.js";
import {
  createDefaultGuildSettings,
  type GuildRoleTemplateOverride,
  type GuildSettings,
  type GuildSettingsPatch,
} from "./types.js";

export type GuildSettingsStore = {
  get(guildId: string): Promise<GuildSettings>;
  update(guildId: string, patch: GuildSettingsPatch): Promise<GuildSettings>;
};

type GuildSettingsRow = {
  bot_log_channel_id: string | null;
  bot_moderator_role_id: string | null;
  guild_id: string;
  linked_at: string | null;
  run_announcement_channel_id: string | null;
  sync_discord_names_to_ff14: number;
  upcoming_raider_role_id: string | null;
  updated_at: string | null;
};

type GuildRoleTemplateOverrideRow = {
  activity_id: number;
  activity_name: string;
  created_at: string | null;
  role_id: string;
  updated_at: string | null;
};

export class SqliteGuildSettingsStore implements GuildSettingsStore {
  private readonly database;

  public constructor(databasePath: string) {
    this.database = openSqliteDatabase(databasePath);
  }

  public get(guildId: string): Promise<GuildSettings> {
    return Promise.resolve(this.readSettings(guildId));
  }

  private readSettings(guildId: string): GuildSettings {
    const row = this.database
      .prepare(
        `
          SELECT
            bot_log_channel_id,
            bot_moderator_role_id,
            guild_id,
            linked_at,
            run_announcement_channel_id,
            sync_discord_names_to_ff14,
            upcoming_raider_role_id,
            updated_at
          FROM guild_settings
          WHERE guild_id = ?
        `,
      )
      .get(guildId) as GuildSettingsRow | undefined;

    const settings = row ? rowToGuildSettings(row) : createDefaultGuildSettings(guildId);
    const overrides = this.getRoleTemplateOverrides(guildId);

    if (overrides.length > 0) {
      settings.runRoleTemplateOverrides = overrides;
    }

    return {
      ...settings,
      ...readScheduleSettings(this.database, guildId),
    };
  }

  public update(guildId: string, patch: GuildSettingsPatch): Promise<GuildSettings> {
    return Promise.resolve().then(() => this.updateSettings(guildId, patch));
  }

  private updateSettings(guildId: string, patch: GuildSettingsPatch): GuildSettings {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.readSettings(guildId);
      const next = mergeGuildSettingsPatch(guildId, current, patch);
      scheduleIntervalDaysSchema.parse(next.scheduleRefreshIntervalDays ?? 1);
      this.database
        .prepare(
          `
          INSERT INTO guild_settings (
            bot_log_channel_id,
            bot_moderator_role_id,
            guild_id,
            linked_at,
            run_announcement_channel_id,
            sync_discord_names_to_ff14,
            upcoming_raider_role_id,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(guild_id) DO UPDATE SET
            bot_log_channel_id = excluded.bot_log_channel_id,
            bot_moderator_role_id = excluded.bot_moderator_role_id,
            linked_at = excluded.linked_at,
            run_announcement_channel_id = excluded.run_announcement_channel_id,
            sync_discord_names_to_ff14 = excluded.sync_discord_names_to_ff14,
            upcoming_raider_role_id = excluded.upcoming_raider_role_id,
            updated_at = excluded.updated_at
        `,
        )
        .run(
          next.botLogChannelId ?? null,
          next.botModeratorRoleId ?? null,
          next.guildId,
          next.linkedAt ?? null,
          next.runAnnouncementChannelId ?? null,
          next.syncDiscordNamesToFf14 ? 1 : 0,
          next.upcomingRaiderRoleId ?? null,
          next.updatedAt ?? null,
        );

      this.replaceRoleTemplateOverrides(
        guildId,
        next.runRoleTemplateOverrides ?? [],
        next.updatedAt ?? new Date().toISOString(),
      );

      writeScheduleSettings(this.database, current, next);
      this.database.exec("COMMIT");
      return next;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  public close(): void {
    this.database.close();
  }

  private getRoleTemplateOverrides(guildId: string): GuildRoleTemplateOverride[] {
    const rows = this.database
      .prepare(
        `
          SELECT
            activity_id,
            activity_name,
            created_at,
            role_id,
            updated_at
          FROM guild_role_template_overrides
          WHERE guild_id = ?
          ORDER BY activity_name COLLATE NOCASE, activity_id
        `,
      )
      .all(guildId) as GuildRoleTemplateOverrideRow[];

    return rows.map((row) => {
      const override: GuildRoleTemplateOverride = {
        activityId: row.activity_id,
        activityName: row.activity_name,
        roleId: row.role_id,
      };

      if (row.created_at) {
        override.createdAt = row.created_at;
      }

      if (row.updated_at) {
        override.updatedAt = row.updated_at;
      }

      return override;
    });
  }

  private replaceRoleTemplateOverrides(
    guildId: string,
    overrides: GuildRoleTemplateOverride[],
    updatedAt: string,
  ): void {
    const existingOverrides = new Map(
      this.getRoleTemplateOverrides(guildId).map((override) => [
        override.activityId,
        override,
      ]),
    );

    this.database
      .prepare("DELETE FROM guild_role_template_overrides WHERE guild_id = ?")
      .run(guildId);

    const statement = this.database.prepare(`
      INSERT INTO guild_role_template_overrides (
        guild_id,
        activity_id,
        activity_name,
        role_id,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const override of overrides) {
      const existingOverride = existingOverrides.get(override.activityId);

      statement.run(
        guildId,
        override.activityId,
        override.activityName,
        override.roleId,
        override.createdAt ?? existingOverride?.createdAt ?? updatedAt,
        override.updatedAt ?? updatedAt,
      );
    }
  }
}

function mergeGuildSettingsPatch(
  guildId: string,
  current: GuildSettings,
  patch: GuildSettingsPatch,
): GuildSettings {
  const next: GuildSettings = {
    ...current,
    guildId,
    syncDiscordNamesToFf14:
      patch.syncDiscordNamesToFf14 ?? current.syncDiscordNamesToFf14,
    updatedAt: new Date().toISOString(),
  };
  const runRoleTemplateOverrides = getRoleTemplateOverridesPatchValue(
    patch,
    current.runRoleTemplateOverrides,
  );
  const botLogChannelId = getPatchValue(
    patch,
    "botLogChannelId",
    current.botLogChannelId,
  );
  const botModeratorRoleId = getPatchValue(
    patch,
    "botModeratorRoleId",
    current.botModeratorRoleId,
  );
  const runAnnouncementChannelId = getPatchValue(
    patch,
    "runAnnouncementChannelId",
    current.runAnnouncementChannelId,
  );
  const linkedAt = getPatchValue(patch, "linkedAt", current.linkedAt);
  const scheduleChannelId = getPatchValue(
    patch,
    "scheduleRefreshChannelId",
    current.scheduleRefreshChannelId,
  );
  if (scheduleChannelId) next.scheduleRefreshChannelId = scheduleChannelId;
  else delete next.scheduleRefreshChannelId;
  if (patch.scheduleRefreshEnabled !== undefined)
    next.scheduleRefreshEnabled = patch.scheduleRefreshEnabled;
  if (patch.scheduleRefreshIntervalDays !== undefined)
    next.scheduleRefreshIntervalDays = patch.scheduleRefreshIntervalDays;
  const upcomingRaiderRoleId = getPatchValue(
    patch,
    "upcomingRaiderRoleId",
    current.upcomingRaiderRoleId,
  );

  if (botLogChannelId) {
    next.botLogChannelId = botLogChannelId;
  } else delete next.botLogChannelId;

  if (botModeratorRoleId) {
    next.botModeratorRoleId = botModeratorRoleId;
  } else delete next.botModeratorRoleId;

  if (runAnnouncementChannelId) {
    next.runAnnouncementChannelId = runAnnouncementChannelId;
  } else delete next.runAnnouncementChannelId;

  if (linkedAt) {
    next.linkedAt = linkedAt;
  } else delete next.linkedAt;

  if (upcomingRaiderRoleId) {
    next.upcomingRaiderRoleId = upcomingRaiderRoleId;
  } else delete next.upcomingRaiderRoleId;

  if (runRoleTemplateOverrides) {
    next.runRoleTemplateOverrides = runRoleTemplateOverrides;
  }

  return next;
}

function getRoleTemplateOverridesPatchValue(
  patch: GuildSettingsPatch,
  currentValue: GuildRoleTemplateOverride[] | undefined,
): GuildRoleTemplateOverride[] | undefined {
  return Object.prototype.hasOwnProperty.call(patch, "runRoleTemplateOverrides")
    ? patch.runRoleTemplateOverrides
    : currentValue;
}

function getPatchValue(
  patch: GuildSettingsPatch,
  key: keyof Omit<
    GuildSettingsPatch,
    | "runRoleTemplateOverrides"
    | "syncDiscordNamesToFf14"
    | "scheduleRefreshEnabled"
    | "scheduleRefreshIntervalDays"
  >,
  currentValue: string | undefined,
): string | null | undefined {
  return Object.prototype.hasOwnProperty.call(patch, key) ? patch[key] : currentValue;
}

function rowToGuildSettings(row: GuildSettingsRow): GuildSettings {
  const settings: GuildSettings = {
    guildId: row.guild_id,
    syncDiscordNamesToFf14: row.sync_discord_names_to_ff14 === 1,
  };

  if (row.bot_log_channel_id) {
    settings.botLogChannelId = row.bot_log_channel_id;
  }

  if (row.bot_moderator_role_id) {
    settings.botModeratorRoleId = row.bot_moderator_role_id;
  }

  if (row.run_announcement_channel_id) {
    settings.runAnnouncementChannelId = row.run_announcement_channel_id;
  }

  if (row.linked_at) {
    settings.linkedAt = row.linked_at;
  }

  if (row.upcoming_raider_role_id) {
    settings.upcomingRaiderRoleId = row.upcoming_raider_role_id;
  }

  if (row.updated_at) {
    settings.updatedAt = row.updated_at;
  }

  return settings;
}
