import type { DatabaseSync } from "node:sqlite";
import { addColumnIfMissing } from "../migrationHelpers.js";

export function failures(database: DatabaseSync): void {
  database.exec(`
      CREATE TABLE IF NOT EXISTS bot_failures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        occurred_at TEXT NOT NULL,
        affects_health INTEGER NOT NULL DEFAULT 1
          CHECK (affects_health IN (0, 1)),
        severity TEXT NOT NULL CHECK (severity IN ('warn', 'error')),
        source TEXT NOT NULL,
        action TEXT NOT NULL,
        message TEXT NOT NULL,
        error_code TEXT,
        event_type TEXT,
        discord_guild_id TEXT,
        discord_user_id TEXT,
        run_id INTEGER,
        details_json TEXT
      )
    `);
  addColumnIfMissing(
    database,
    "bot_failures",
    "affects_health",
    "INTEGER NOT NULL DEFAULT 1 CHECK (affects_health IN (0, 1))",
  );
  database.exec(`
      CREATE INDEX IF NOT EXISTS bot_failures_occurred_at_idx
      ON bot_failures (occurred_at)
    `);
  database.exec(`
      CREATE INDEX IF NOT EXISTS bot_failures_source_occurred_at_idx
      ON bot_failures (source, occurred_at)
    `);
}
