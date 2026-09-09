import type { DatabaseSync } from "node:sqlite";

export function addColumnIfMissing(
  database: DatabaseSync,
  table: string,
  column: string,
  definition: string,
): void {
  if (![table, column].every((value) => /^[a-z_]+$/u.test(value)))
    throw new Error("Invalid migration identifier.");
  const columns = database.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((value) => value.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
