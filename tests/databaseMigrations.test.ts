import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { migrateBotDatabase } from "../src/database/migrations.js";

describe("database migrations", () => {
  it("is idempotent and retains existing guild settings", () => {
    const database = new DatabaseSync(":memory:");
    try {
      migrateBotDatabase(database);
      database
        .prepare(
          "INSERT INTO guild_settings (guild_id, upcoming_raider_role_id) VALUES (?, ?)",
        )
        .run("guild", "template");
      const applied = database.prepare("SELECT * FROM bot_schema_migrations").all();
      migrateBotDatabase(database);
      expect(database.prepare("SELECT * FROM bot_schema_migrations").all()).toEqual(
        applied,
      );
      expect(
        database
          .prepare(
            "SELECT upcoming_raider_role_id FROM guild_settings WHERE guild_id = ?",
          )
          .get("guild"),
      ).toMatchObject({ upcoming_raider_role_id: "template" });
    } finally {
      database.close();
    }
  });

  it("archives incompatible legacy overrides instead of destroying them", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(
        "CREATE TABLE guild_role_template_overrides (guild_id TEXT, activity_key TEXT, role_id TEXT)",
      );
      database
        .prepare("INSERT INTO guild_role_template_overrides VALUES (?, ?, ?)")
        .run("guild", "legacy-activity", "template");
      migrateBotDatabase(database);
      expect(
        database.prepare("SELECT * FROM guild_role_template_overrides_legacy").all(),
      ).toMatchObject([
        { guild_id: "guild", activity_key: "legacy-activity", role_id: "template" },
      ]);
      expect(
        database.prepare("PRAGMA table_info(guild_role_template_overrides)").all(),
      ).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "activity_id" })]),
      );
    } finally {
      database.close();
    }
  });

  it("rolls back schema changes and version records when an upgrade fails", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(
        "CREATE TABLE guild_role_template_overrides (guild_id TEXT); CREATE TABLE guild_role_template_overrides_legacy (guild_id TEXT)",
      );
      expect(() => {
        migrateBotDatabase(database);
      }).toThrow();
      expect(database.prepare("SELECT * FROM bot_schema_migrations").all()).toEqual([]);
      expect(
        database
          .prepare("SELECT name FROM sqlite_master WHERE name = 'guild_settings'")
          .get(),
      ).toBeUndefined();
    } finally {
      database.close();
    }
  });
});
