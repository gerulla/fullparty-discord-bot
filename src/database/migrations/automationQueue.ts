import type { DatabaseSync } from "node:sqlite";
import { addColumnIfMissing } from "../migrationHelpers.js";

export function automationQueue(database: DatabaseSync): void {
  database.exec(`
      CREATE TABLE IF NOT EXISTS guild_run_reminder_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dedupe_key TEXT NOT NULL UNIQUE,
        discord_guild_id TEXT NOT NULL,
        job_kind TEXT NOT NULL DEFAULT 'run_reminder'
          CHECK (job_kind IN ('run_reminder', 'run_completed')),
        run_id INTEGER NOT NULL,
        reminder_type TEXT,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued'
          CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
        payload_json TEXT NOT NULL,
        result_json TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        available_at TEXT NOT NULL,
        locked_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  addColumnIfMissing(
    database,
    "guild_run_reminder_jobs",
    "job_kind",
    "TEXT NOT NULL DEFAULT 'run_reminder'",
  );
  database.exec(`
      CREATE INDEX IF NOT EXISTS guild_run_reminder_jobs_status_available_idx
      ON guild_run_reminder_jobs (status, available_at, created_at)
    `);
}
