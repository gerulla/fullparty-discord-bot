import type { DatabaseSync } from "node:sqlite";

export function migrateAdminDatabase(database: DatabaseSync): void {
  database.exec(
    "CREATE TABLE IF NOT EXISTS admin_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  if (
    database
      .prepare("SELECT version FROM admin_schema_migrations WHERE version = 1")
      .get()
  )
    return;
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS bot_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        occurred_at TEXT NOT NULL,
        event_type TEXT NOT NULL,
        data_type TEXT,
        request_host TEXT,
        request_id TEXT,
        discord_guild_id TEXT,
        discord_user_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('accepted', 'failed')),
        error_code TEXT
      )
    `);
    database.exec(`
      CREATE INDEX IF NOT EXISTS bot_events_occurred_at_idx
      ON bot_events (occurred_at)
    `);
    database.exec(`
      CREATE INDEX IF NOT EXISTS bot_events_status_occurred_at_idx
      ON bot_events (status, occurred_at)
    `);
    database.exec(`
      CREATE INDEX IF NOT EXISTS bot_events_guild_occurred_at_idx
      ON bot_events (discord_guild_id, occurred_at)
    `);
    database.exec(`
      CREATE TABLE IF NOT EXISTS dm_deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        occurred_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'failed')),
        discord_user_id TEXT NOT NULL,
        event_type TEXT,
        notification_type TEXT,
        queued_at TEXT,
        sent_at TEXT,
        message_id TEXT,
        error_code TEXT,
        error_message TEXT
      )
    `);
    database.exec(`
      CREATE INDEX IF NOT EXISTS dm_deliveries_occurred_at_idx
      ON dm_deliveries (occurred_at)
    `);
    database.exec(`
      CREATE INDEX IF NOT EXISTS dm_deliveries_user_occurred_at_idx
      ON dm_deliveries (discord_user_id, occurred_at)
    `);
    database.exec(`
      CREATE TABLE IF NOT EXISTS command_usages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        occurred_at TEXT NOT NULL,
        command_name TEXT NOT NULL,
        discord_guild_id TEXT,
        discord_user_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
        duration_ms INTEGER,
        error_code TEXT
      )
    `);
    database.exec(`
      CREATE INDEX IF NOT EXISTS command_usages_occurred_at_idx
      ON command_usages (occurred_at)
    `);
    database.exec(`
      CREATE INDEX IF NOT EXISTS command_usages_status_occurred_at_idx
      ON command_usages (status, occurred_at)
    `);
    database.exec(`
      CREATE INDEX IF NOT EXISTS command_usages_guild_occurred_at_idx
      ON command_usages (discord_guild_id, occurred_at)
    `);
    database.exec(`
      CREATE TABLE IF NOT EXISTS guild_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        occurred_at TEXT NOT NULL,
        message_type TEXT NOT NULL,
        discord_guild_id TEXT,
        channel_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
        message_id TEXT,
        error_code TEXT,
        error_message TEXT
      )
    `);
    database.exec(`
      CREATE INDEX IF NOT EXISTS guild_messages_occurred_at_idx
      ON guild_messages (occurred_at)
    `);
    database.exec(`
      CREATE INDEX IF NOT EXISTS guild_messages_status_occurred_at_idx
      ON guild_messages (status, occurred_at)
    `);
    database.exec(`
      CREATE INDEX IF NOT EXISTS guild_messages_guild_occurred_at_idx
      ON guild_messages (discord_guild_id, occurred_at)
    `);
    database.exec(`
      CREATE TABLE IF NOT EXISTS guild_runtime (
        discord_guild_id TEXT PRIMARY KEY,
        name TEXT,
        member_count INTEGER,
        linked_at TEXT,
        bot_permissions TEXT,
        last_seen_at TEXT NOT NULL,
        unavailable INTEGER NOT NULL DEFAULT 0 CHECK (unavailable IN (0, 1))
      )
    `);
    database.exec(`
      CREATE TABLE IF NOT EXISTS automation_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        occurred_at TEXT NOT NULL,
        automation_type TEXT NOT NULL
          CHECK (automation_type IN ('role_assignment', 'nickname_sync', 'role_cleanup')),
        event_type TEXT,
        discord_guild_id TEXT,
        run_id INTEGER,
        status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'partial', 'skipped')),
        success_count INTEGER NOT NULL DEFAULT 0,
        failure_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER,
        result_json TEXT
      )
    `);
    database.exec(`
      CREATE INDEX IF NOT EXISTS automation_runs_occurred_at_idx
      ON automation_runs (occurred_at)
    `);
    database.exec(`
      CREATE INDEX IF NOT EXISTS automation_runs_guild_run_idx
      ON automation_runs (discord_guild_id, run_id, occurred_at)
    `);
    database.exec(`
      CREATE INDEX IF NOT EXISTS automation_runs_guild_occurred_at_idx
      ON automation_runs (discord_guild_id, occurred_at)
    `);

    database
      .prepare("INSERT INTO admin_schema_migrations (version, applied_at) VALUES (1, ?)")
      .run(new Date().toISOString());
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
