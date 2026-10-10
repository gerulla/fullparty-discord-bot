import type { DatabaseSync } from "node:sqlite";

export function dmRetries(database: DatabaseSync): void {
  database.exec(`
    ALTER TABLE user_dm_jobs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE user_dm_jobs ADD COLUMN available_at INTEGER NOT NULL DEFAULT 0;
    CREATE INDEX user_dm_jobs_completed_idx ON user_dm_jobs(completed_at)
      WHERE status != 'queued';
    CREATE INDEX user_dm_sent_times_time_idx ON user_dm_sent_times(sent_at);
  `);
}
