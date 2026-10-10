import type { DatabaseSync } from "node:sqlite";
import { addColumnIfMissing } from "../migrationHelpers.js";

export function guildGroupSlug(database: DatabaseSync): void {
  addColumnIfMissing(database, "guild_settings", "group_slug", "TEXT");
}
