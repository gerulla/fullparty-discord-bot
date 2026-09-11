import type { DatabaseSync } from "node:sqlite";

export function guildSchedule(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS guild_schedule_refresh (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
      channel_id TEXT,
      interval_days INTEGER NOT NULL DEFAULT 1 CHECK (interval_days BETWEEN 1 AND 7),
      revision INTEGER NOT NULL DEFAULT 1,
      message_id TEXT,
      message_channel_id TEXT,
      next_refresh_at TEXT NOT NULL,
      last_refreshed_at TEXT,
      last_attempt_at TEXT,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS guild_schedule_refresh_due
      ON guild_schedule_refresh (enabled, next_refresh_at);
  `);
}
