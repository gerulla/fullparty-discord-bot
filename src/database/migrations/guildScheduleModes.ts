import type { DatabaseSync } from "node:sqlite";
import { addColumnIfMissing } from "../migrationHelpers.js";

export function guildScheduleModes(database: DatabaseSync): void {
  addColumnIfMissing(
    database,
    "guild_schedule_refresh",
    "mode",
    "TEXT NOT NULL DEFAULT 'disabled' CHECK (mode IN ('disabled', 'timed_refresh', 'run_detection'))",
  );
  addColumnIfMissing(
    database,
    "guild_schedule_refresh",
    "refresh_pending",
    "INTEGER NOT NULL DEFAULT 0 CHECK (refresh_pending IN (0, 1))",
  );

  // The existing /postruns destination wins; retain the old automatic channel
  // when it is the only configured destination. Keep tracked posts for replacement.
  database.exec(`
    UPDATE guild_settings
    SET run_announcement_channel_id = (
      SELECT channel_id FROM guild_schedule_refresh
      WHERE guild_schedule_refresh.guild_id = guild_settings.guild_id
    )
    WHERE run_announcement_channel_id IS NULL;

    UPDATE guild_schedule_refresh
    SET mode = CASE WHEN enabled = 1 THEN 'timed_refresh' ELSE 'disabled' END,
      refresh_pending = enabled,
      channel_id = (
        SELECT run_announcement_channel_id FROM guild_settings
        WHERE guild_settings.guild_id = guild_schedule_refresh.guild_id
      );

    CREATE INDEX IF NOT EXISTS guild_schedule_refresh_modes_due
      ON guild_schedule_refresh (next_refresh_at, guild_id)
      WHERE mode = 'timed_refresh' OR (mode = 'run_detection' AND refresh_pending = 1);
  `);
}
