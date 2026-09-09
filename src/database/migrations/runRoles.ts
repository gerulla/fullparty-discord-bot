import type { DatabaseSync } from "node:sqlite";

export function runRoles(database: DatabaseSync): void {
  database.exec(`
      CREATE TABLE IF NOT EXISTS guild_run_roles (
        discord_guild_id TEXT NOT NULL,
        run_id INTEGER NOT NULL,
        role_id TEXT NOT NULL,
        role_name TEXT NOT NULL,
        template_role_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'deleted')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        PRIMARY KEY (discord_guild_id, run_id)
      )
    `);
}
