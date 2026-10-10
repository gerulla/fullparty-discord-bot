import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Client } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serializeGuildSettings } from "../src/guildAutomation/guildSnapshot.js";
import { updateGuildSettingsFromFullparty } from "../src/guildIntegration/settingsService.js";
import type { GuildIntegrationOptions } from "../src/guildIntegration/types.js";
import {
  formatScheduleFormat,
  scheduleFormatSchema,
} from "../src/guildSchedule/settings.js";
import { SqliteGuildScheduleStore } from "../src/guildSchedule/store.js";
import { SqliteGuildSettingsStore } from "../src/guildSettings/store.js";
import type { GuildSettingsPatch } from "../src/guildSettings/types.js";
import { guildSettingsUpdatedDataSchema } from "../src/http/eventSchemas.js";

describe("schedule format settings", () => {
  const resources: { close(): void }[] = [];
  const directories: string[] = [];

  afterEach(async () => {
    for (const resource of resources.splice(0)) resource.close();
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { recursive: true })),
    );
  });

  it("defaults unknown and existing guilds to Plain", async () => {
    const { settings } = await createFixture();
    expect(serializeGuildSettings(await settings.get("unknown")).schedule_format).toBe(
      "plain",
    );
    await expect(settings.update("guild", {})).resolves.toMatchObject({
      scheduleFormat: "plain",
    });
    expect(scheduleFormatSchema.options.map(formatScheduleFormat)).toEqual([
      "Plain",
      "Expanded",
      "Interactive",
    ]);
  });

  it.each(scheduleFormatSchema.options)(
    "persists %s across reopening and unrelated changes",
    async (scheduleFormat) => {
      const { path, settings } = await createFixture();
      await settings.update("guild", {
        scheduleFormat,
        botLogChannelId: "log-channel",
        runAnnouncementChannelId: "schedule-channel",
        syncDiscordNamesToFf14: true,
      });
      await settings.update("guild", { botModeratorRoleId: "moderator" });
      const reopened = new SqliteGuildSettingsStore(path);
      resources.push(reopened);
      await expect(reopened.get("guild")).resolves.toMatchObject({
        scheduleFormat,
        botLogChannelId: "log-channel",
        botModeratorRoleId: "moderator",
        runAnnouncementChannelId: "schedule-channel",
        syncDiscordNamesToFf14: true,
      });
    },
  );

  it.each(["timed_refresh", "run_detection"] as const)(
    "queues a refresh and invalidates stale %s work when its format changes",
    async (scheduleMode) => {
      const { path, settings } = await createFixture();
      const schedule = new SqliteGuildScheduleStore(path);
      resources.push(schedule);
      await settings.update("guild", {
        scheduleMode,
        linkedAt: "2026-10-10T12:00:00.000Z",
        runAnnouncementChannelId: "schedule-channel",
      });
      const now = new Date(Date.now() + 1000);
      const job = schedule.listDue(now)[0];
      if (!job) throw new Error("Expected initial schedule job");
      expect(job.schedule_format).toBe("plain");
      schedule.complete(job, "existing-message", now);
      await settings.update("guild", { scheduleFormat: "expanded" });
      const expandedJob = schedule.listDue(now)[0];
      expect(expandedJob).toMatchObject({
        schedule_format: "expanded",
        refresh_pending: 1,
        message_id: "existing-message",
      });
      expect(schedule.isCurrent(job)).toBe(false);
      if (!expandedJob) throw new Error("Expected format refresh");
      const pending = schedule.get("guild");
      await settings.update("guild", { scheduleFormat: "expanded" });
      expect(schedule.get("guild")).toEqual(pending);
      await settings.update("guild", { scheduleFormat: "plain" });
      expect(schedule.isCurrent(expandedJob)).toBe(false);
      schedule.complete(expandedJob, "in-flight-expanded-message", now);
      expect(schedule.listDue(now)[0]).toMatchObject({
        schedule_format: "plain",
        refresh_pending: 1,
        message_id: "in-flight-expanded-message",
      });
    },
  );

  it("saves a disabled schedule's format without queuing any work", async () => {
    const { path, settings } = await createFixture();
    const schedule = new SqliteGuildScheduleStore(path);
    resources.push(schedule);
    await settings.update("guild", {
      scheduleMode: "disabled",
      linkedAt: "2026-10-10T12:00:00.000Z",
      runAnnouncementChannelId: "schedule-channel",
    });
    const previous = schedule.get("guild");
    await settings.update("guild", { scheduleFormat: "expanded" });
    expect(schedule.get("guild")).toEqual(previous);
    expect(schedule.listDue(new Date(Date.now() + 1000))).toEqual([]);
    await settings.update("guild", { scheduleMode: "run_detection" });
    expect(schedule.listDue(new Date(Date.now() + 1000))[0]).toMatchObject({
      schedule_format: "expanded",
    });
  });

  it.each(["unsupported", "", null, 123])(
    "rejects invalid format %j without saving any part of the patch",
    async (scheduleFormat) => {
      const { settings } = await createFixture();
      await settings.update("guild", {
        scheduleFormat: "expanded",
        botLogChannelId: "original-log",
      });
      const original = await settings.get("guild");
      await expect(
        settings.update("guild", {
          scheduleFormat,
          botLogChannelId: "must-not-save",
        } as unknown as GuildSettingsPatch),
      ).rejects.toThrow();
      await expect(settings.get("guild")).resolves.toEqual(original);
    },
  );

  it("migrates existing settings to Plain without resetting scheduling or other preferences", async () => {
    const { path, settings } = await createFixture();
    await settings.update("guild", {
      botLogChannelId: "log-channel",
      groupSlug: "example-group",
      linkedAt: "2026-10-10T12:00:00.000Z",
      runAnnouncementChannelId: "schedule-channel",
      scheduleMode: "run_detection",
    });
    settings.close();
    resources.splice(resources.indexOf(settings), 1);
    const legacy = new DatabaseSync(path);
    const before = legacy.prepare("SELECT * FROM guild_schedule_refresh").all();
    try {
      legacy.exec("ALTER TABLE guild_settings DROP COLUMN schedule_format");
      legacy.prepare("DELETE FROM bot_schema_migrations WHERE version = ?").run(12);
    } finally {
      legacy.close();
    }
    const migrated = new SqliteGuildSettingsStore(path);
    resources.push(migrated);
    await expect(migrated.get("guild")).resolves.toMatchObject({
      scheduleFormat: "plain",
      botLogChannelId: "log-channel",
      groupSlug: "example-group",
      linkedAt: "2026-10-10T12:00:00.000Z",
      runAnnouncementChannelId: "schedule-channel",
      scheduleMode: "run_detection",
    });
    const database = new DatabaseSync(path, { readOnly: true });
    try {
      expect(database.prepare("SELECT * FROM guild_schedule_refresh").all()).toEqual(
        before,
      );
    } finally {
      database.close();
    }
  });

  it.each(scheduleFormatSchema.options)(
    "accepts and serializes settings.schedule_format=%s without resetting it on omission",
    async (scheduleFormat) => {
      const { settings } = await createFixture();
      const options: GuildIntegrationOptions = {
        client: {} as Client,
        context: {
          guildSettings: settings,
          logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        },
      };
      const apply = (patch: Record<string, unknown>) =>
        updateGuildSettingsFromFullparty(
          options,
          guildSettingsUpdatedDataSchema.parse({
            discord_guild_id: "guild",
            settings: patch,
          }),
        );
      await expect(apply({ schedule_format: scheduleFormat })).resolves.toMatchObject({
        updated: true,
        settings: { schedule_format: scheduleFormat },
      });
      await expect(apply({ bot_log_channel_id: "log" })).resolves.toMatchObject({
        settings: { schedule_format: scheduleFormat, bot_log_channel_id: "log" },
      });
    },
  );

  it.each(["unsupported", "Plain", "", null, 123])(
    "rejects invalid website schedule_format=%j",
    (scheduleFormat) => {
      expect(
        guildSettingsUpdatedDataSchema.safeParse({
          discord_guild_id: "guild",
          settings: { schedule_format: scheduleFormat },
        }).success,
      ).toBe(false);
    },
  );

  async function createFixture() {
    const directory = await mkdtemp(join(tmpdir(), "fullparty-schedule-format-"));
    directories.push(directory);
    const path = join(directory, "settings.sqlite");
    const settings = new SqliteGuildSettingsStore(path);
    resources.push(settings);
    return { path, settings };
  }
});
