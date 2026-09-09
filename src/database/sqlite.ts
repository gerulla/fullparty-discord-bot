import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrateBotDatabase } from "./migrations.js";

export function openSqliteDatabase(databasePath: string): DatabaseSync {
  ensureDatabaseDirectory(databasePath);

  const database = new DatabaseSync(databasePath);

  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA busy_timeout = 5000");
    migrateBotDatabase(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

function ensureDatabaseDirectory(databasePath: string): void {
  if (databasePath === ":memory:") {
    return;
  }

  mkdirSync(dirname(databasePath), { recursive: true });
}
