import type { DatabaseSync } from "node:sqlite";

export function dmQueue(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS user_dm_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_user_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      queued_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'sent', 'failed')),
      completed_at INTEGER,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS user_dm_jobs_pending_idx ON user_dm_jobs(status, id);
    CREATE TABLE IF NOT EXISTS user_dm_sent_times (discord_user_id TEXT NOT NULL, sent_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS user_dm_sent_times_user_idx ON user_dm_sent_times(discord_user_id, sent_at);
  `);
}
