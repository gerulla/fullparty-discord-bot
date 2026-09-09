import type { DatabaseSync } from "node:sqlite";
import { addColumnIfMissing } from "../migrationHelpers.js";

export function memberCache(database: DatabaseSync): void {
  database.exec(`
      CREATE TABLE IF NOT EXISTS guild_member_cache (
        discord_guild_id TEXT NOT NULL,
        discord_user_id TEXT NOT NULL,
        refreshed_at TEXT NOT NULL,
        seen_at TEXT NOT NULL,
        source TEXT NOT NULL
          CHECK (source IN ('full_refresh', 'member_event')),
        PRIMARY KEY (discord_guild_id, discord_user_id)
      )
    `);
  database.exec(`
      CREATE INDEX IF NOT EXISTS guild_member_cache_guild_idx
      ON guild_member_cache (discord_guild_id)
    `);
  database.exec(`
      CREATE TABLE IF NOT EXISTS guild_member_cache_status (
        discord_guild_id TEXT PRIMARY KEY,
        member_count INTEGER,
        cached_member_count INTEGER NOT NULL DEFAULT 0,
        last_full_refresh_at TEXT,
        next_refresh_after TEXT,
        refresh_status TEXT NOT NULL DEFAULT 'missing'
          CHECK (refresh_status IN ('missing', 'refreshing', 'fresh', 'failed')),
        last_error TEXT,
        obsolete_at TEXT,
        updated_at TEXT NOT NULL
      )
    `);
  addColumnIfMissing(database, "guild_member_cache_status", "obsolete_at", "TEXT");
}
