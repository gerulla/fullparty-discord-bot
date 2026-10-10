import type { DatabaseSync } from "node:sqlite";
import { addColumnIfMissing } from "../migrationHelpers.js";

export function guildScheduleFormat(database: DatabaseSync): void {
  addColumnIfMissing(
    database,
    "guild_settings",
    "schedule_format",
    "TEXT NOT NULL DEFAULT 'plain' CHECK (schedule_format IN ('plain', 'expanded', 'interactive'))",
  );
}
