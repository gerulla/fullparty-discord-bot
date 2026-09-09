import type { DatabaseSync } from "node:sqlite";
import { addColumnIfMissing } from "../migrationHelpers.js";

export function guildSettings(database: DatabaseSync): void {
  database.exec(`
      CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id TEXT PRIMARY KEY,
        bot_log_channel_id TEXT,
        bot_moderator_role_id TEXT,
        linked_at TEXT,
        run_announcement_channel_id TEXT,
        upcoming_raider_role_id TEXT,
        sync_discord_names_to_ff14 INTEGER NOT NULL DEFAULT 0
          CHECK (sync_discord_names_to_ff14 IN (0, 1)),
        updated_at TEXT
      )
    `);
  addColumnIfMissing(database, "guild_settings", "bot_moderator_role_id", "TEXT");
  addColumnIfMissing(database, "guild_settings", "linked_at", "TEXT");

  database.exec(`
      CREATE TABLE IF NOT EXISTS guild_role_template_overrides (
        guild_id TEXT NOT NULL,
        activity_id INTEGER NOT NULL,
        activity_name TEXT NOT NULL,
        role_id TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT,
        PRIMARY KEY (guild_id, activity_id)
      )
    `);
  const columns = database
    .prepare("PRAGMA table_info(guild_role_template_overrides)")
    .all();
  if (!columns.some((column) => column.name === "activity_id")) {
    database.exec(
      "ALTER TABLE guild_role_template_overrides RENAME TO guild_role_template_overrides_legacy",
    );
    database.exec(`CREATE TABLE guild_role_template_overrides (
        guild_id TEXT NOT NULL,
        activity_id INTEGER NOT NULL,
        activity_name TEXT NOT NULL,
        role_id TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT,
        PRIMARY KEY (guild_id, activity_id)
      )`);
  }
}
