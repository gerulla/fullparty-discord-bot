import type { DatabaseSync } from "node:sqlite";
import { automationQueue } from "./migrations/automationQueue.js";
import { dmQueue } from "./migrations/dmQueue.js";
import { failures } from "./migrations/failures.js";
import { guildSettings } from "./migrations/guildSettings.js";
import { guildSchedule } from "./migrations/guildSchedule.js";
import { memberCache } from "./migrations/memberCache.js";
import { runRoles } from "./migrations/runRoles.js";

const migrations = [
  guildSettings,
  runRoles,
  automationQueue,
  memberCache,
  failures,
  dmQueue,
  guildSchedule,
];

export function migrateBotDatabase(database: DatabaseSync): void {
  database.exec(
    "CREATE TABLE IF NOT EXISTS bot_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const [index, migrate] of migrations.entries()) {
      const version = index + 1;
      if (
        database
          .prepare("SELECT version FROM bot_schema_migrations WHERE version = ?")
          .get(version)
      )
        continue;
      migrate(database);
      database
        .prepare("INSERT INTO bot_schema_migrations (version, applied_at) VALUES (?, ?)")
        .run(version, new Date().toISOString());
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
