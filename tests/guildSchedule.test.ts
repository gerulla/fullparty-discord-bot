import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import type { Client } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BotContext } from "../src/bot/context.js";
import { FullpartyApiClient } from "../src/fullparty/client.js";
import { GuildScheduleScheduler } from "../src/guildSchedule/scheduler.js";
import { SqliteGuildScheduleStore } from "../src/guildSchedule/store.js";
import { ScheduleRefreshError } from "../src/guildSchedule/publisher.js";
import { SqliteGuildSettingsStore } from "../src/guildSettings/store.js";
import { SqliteFailureReporter } from "../src/health/failureReporter.js";
import { LatestPayloadStore } from "../src/payloads/latestPayloadStore.js";

const now = new Date("2026-09-11T12:00:00Z");
const day = 86_400_000;
const cleanup: (() => void | Promise<void>)[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
});
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.useRealTimers();
});

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), "fullparty-schedule-test-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "bot.sqlite");
  const settings = new SqliteGuildSettingsStore(path);
  const store = new SqliteGuildScheduleStore(path);
  const reporter = new SqliteFailureReporter({
    databasePath: path,
    logFilePath: join(directory, "failures.jsonl"),
  });
  cleanup.push(
    () => {
      settings.close();
    },
    () => {
      store.close();
    },
    () => {
      reporter.close();
    },
  );
  await settings.update("guild", {
    linkedAt: now.toISOString(),
    scheduleRefreshEnabled: true,
    scheduleRefreshChannelId: "channel",
    scheduleRefreshIntervalDays: 1,
  });
  const context: BotContext = {
    guildSettings: settings,
    guildScheduleStore: store,
    failureReporter: reporter,
    fullparty: new FullpartyApiClient({ baseUrl: "https://fullparty.gg/api" }),
    fullpartyWebBaseUrl: "https://fullparty.gg",
    payloads: new LatestPayloadStore(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
  const sendLog = vi.fn(() => Promise.resolve({ id: "log-message" }));
  const client = {
    isReady: vi.fn(() => true),
    guilds: { cache: new Map([["guild", { available: true }]]) },
    channels: { fetch: vi.fn(() => Promise.resolve({ send: sendLog })) },
  };
  function scheduler(
    replace: ConstructorParameters<
      typeof GuildScheduleScheduler
    >[0]["publisher"]["replace"],
  ) {
    const worker = new GuildScheduleScheduler({
      client: client as unknown as Client,
      context,
      store,
      publisher: { replace },
    });
    cleanup.push(() => worker.stop());
    return worker;
  }
  return { context, settings, store, path, client, reporter, scheduler, sendLog };
}

describe("persistent guild schedules", () => {
  it("migrates a previous-version database without resetting existing guild settings", async () => {
    const { settings, path } = await createFixture();
    await settings.update("guild", { botLogChannelId: "existing-log-channel" });
    const legacy = new DatabaseSync(path);
    try {
      legacy.exec("DROP TABLE guild_schedule_refresh");
      legacy.prepare("DELETE FROM bot_schema_migrations WHERE version = ?").run(7);
    } finally {
      legacy.close();
    }
    const migrated = new SqliteGuildScheduleStore(path);
    cleanup.push(() => {
      migrated.close();
    });
    expect(migrated.listDue(now)).toEqual([]);
    await expect(settings.get("guild")).resolves.toMatchObject({
      botLogChannelId: "existing-log-channel",
      linkedAt: now.toISOString(),
    });
  });

  it("preserves two concurrent settings patches", async () => {
    const { settings } = await createFixture();
    await Promise.all([
      settings.update("guild", { scheduleRefreshIntervalDays: 7 }),
      settings.update("guild", { scheduleRefreshChannelId: "new-channel" }),
    ]);
    await expect(settings.get("guild")).resolves.toMatchObject({
      scheduleRefreshIntervalDays: 7,
      scheduleRefreshChannelId: "new-channel",
    });
  });
  it.each([1, 2, 3, 4, 5, 6, 7])(
    "persists a %i-day interval and the next due time across reopening",
    async (days) => {
      const fixture = await createFixture();
      await fixture.settings.update("guild", { scheduleRefreshIntervalDays: days });
      const job = fixture.store.listDue(now)[0];
      if (!job) throw new Error("Expected due job");
      fixture.store.complete(job, "automatic-message", now);
      const reopened = new SqliteGuildScheduleStore(fixture.path);
      cleanup.push(() => {
        reopened.close();
      });
      expect(reopened.get("guild")).toMatchObject({
        message_id: "automatic-message",
        channel_id: "channel",
        interval_days: days,
        next_refresh_at: new Date(now.getTime() + days * day).toISOString(),
      });
      expect(reopened.listDue(new Date(now.getTime() + days * day - 1))).toEqual([]);
      expect(reopened.listDue(new Date(now.getTime() + days * day))).toHaveLength(1);
      await expect(fixture.settings.get("guild")).resolves.toMatchObject({
        scheduleRefreshEnabled: true,
        scheduleRefreshIntervalDays: days,
        scheduleRefreshChannelId: "channel",
      });
    },
  );

  it("preserves the schedule on unrelated settings edits, but cancels stale jobs on changes", async () => {
    const { settings, store } = await createFixture();
    const job = store.listDue(now)[0];
    if (!job) throw new Error("Expected job");
    store.complete(job, "old-post", now);
    const previous = store.get("guild");
    await settings.update("guild", { botLogChannelId: "log" });
    expect(store.get("guild")).toEqual(previous);
    await settings.update("guild", { scheduleRefreshChannelId: "new-channel" });
    expect(store.isCurrent(job)).toBe(false);
    expect(store.listDue(now)[0]).toMatchObject({
      channel_id: "new-channel",
      message_id: "old-post",
      message_channel_id: "channel",
    });
    await settings.update("guild", { scheduleRefreshChannelId: null });
    expect(store.listDue(now)).toEqual([]);
    await expect(settings.get("guild")).resolves.not.toHaveProperty(
      "scheduleRefreshChannelId",
    );
  });

  it("does not run disabled or unlinked guilds and keeps their last message tracked", async () => {
    const { settings, store } = await createFixture();
    const job = store.listDue(now)[0];
    if (!job) throw new Error("Expected job");
    store.complete(job, "last-post", now);
    await settings.update("guild", { scheduleRefreshEnabled: false });
    expect(store.listDue(new Date(now.getTime() + 8 * day))).toEqual([]);
    expect(store.get("guild")?.message_id).toBe("last-post");
    await settings.update("guild", { scheduleRefreshEnabled: true, linkedAt: null });
    expect(store.listDue(new Date(now.getTime() + 8 * day))).toEqual([]);
    expect(store.isCurrent(job)).toBe(false);
  });

  it.each([0, 8, 1.5, Number.NaN])(
    "rejects an invalid interval before saving settings: %s",
    async (days) => {
      const { settings, store } = await createFixture();
      await expect(
        settings.update("guild", {
          scheduleRefreshIntervalDays: days,
          botLogChannelId: "should-not-save",
        }),
      ).rejects.toThrow();
      expect(store.get("guild")?.interval_days).toBe(1);
      await expect(settings.get("guild")).resolves.not.toHaveProperty("botLogChannelId");
    },
  );

  it("keeps new settings due when an in-flight send completes after configuration changes", async () => {
    const { store, settings } = await createFixture();
    const job = store.listDue(now)[0];
    if (!job) throw new Error("Expected job");
    await settings.update("guild", { scheduleRefreshChannelId: "new-channel" });
    store.complete(job, "in-flight-message", now);
    expect(store.listDue(now)[0]).toMatchObject({
      channel_id: "new-channel",
      message_id: "in-flight-message",
      message_channel_id: "channel",
    });
  });
});

describe("guild schedule scheduler", () => {
  it("records an unexpected failure and suppresses repeated identical bot-log warnings", async () => {
    const { scheduler, settings, reporter, sendLog } = await createFixture();
    await settings.update("guild", { botLogChannelId: "log-channel" });
    const publish = vi.fn(() => Promise.reject(new Error("Upstream timeout")));
    const worker = scheduler(publish);
    worker.start();
    await worker.tick();
    vi.setSystemTime(new Date(now.getTime() + 3_600_000));
    await worker.tick();
    expect(publish).toHaveBeenCalledTimes(2);
    expect(sendLog).toHaveBeenCalledTimes(1);
    await expect(reporter.getHealthSummary()).resolves.toMatchObject({
      errorCount: 1,
      status: "degraded",
    });
  });
  it("runs an overdue job once and schedules the next refresh, without replaying missed days", async () => {
    const { scheduler, store } = await createFixture();
    vi.setSystemTime(new Date(now.getTime() + 5 * day));
    const publish = vi.fn(() => Promise.resolve("new-message"));
    const worker = scheduler(publish);
    worker.start();
    await worker.tick();
    await worker.tick();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(store.get("guild")?.next_refresh_at).toBe(
      new Date(now.getTime() + 6 * day).toISOString(),
    );
  });

  it("serializes guild jobs and prevents overlapping timer sweeps", async () => {
    const { scheduler, settings, store, client } = await createFixture();
    await settings.update("guild-2", {
      linkedAt: now.toISOString(),
      scheduleRefreshEnabled: true,
      scheduleRefreshChannelId: "channel-2",
    });
    client.guilds.cache.set("guild-2", { available: true });
    let release = () => {
      /* Replaced synchronously by the promise executor. */
    };
    const gate = new Promise<string>((resolve) => {
      release = () => {
        resolve("message-1");
      };
    });
    const publish = vi.fn(() => gate);
    const worker = scheduler(publish);
    worker.start();
    const tick = worker.tick();
    try {
      expect(publish).toHaveBeenCalledTimes(1);
      expect(worker.tick()).toBe(tick);
    } finally {
      release();
    }
    await tick;
    expect(publish).toHaveBeenCalledTimes(2);
    expect(store.listDue(now)).toEqual([]);
  });

  it("ignores departed/unavailable guilds and waits for Discord readiness", async () => {
    const { scheduler, client } = await createFixture();
    client.isReady.mockReturnValue(false);
    const publish = vi.fn(() => Promise.resolve("message"));
    const worker = scheduler(publish);
    worker.start();
    await worker.tick();
    client.isReady.mockReturnValue(true);
    client.guilds.cache.set("guild", { available: false });
    await worker.tick();
    client.guilds.cache.clear();
    await worker.tick();
    expect(publish).not.toHaveBeenCalled();
  });

  it("cancels an in-flight job after disabling and waits for it during shutdown", async () => {
    const { scheduler, settings, store } = await createFixture();
    let release = () => {
      /* Replaced synchronously by the promise executor. */
    };
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const worker = scheduler(async (_job, canContinue) => {
      await gate;
      expect(canContinue()).toBe(false);
      return undefined;
    });
    worker.start();
    await settings.update("guild", { scheduleRefreshEnabled: false });
    let stopped = false;
    const stopping = worker.stop().then(() => {
      stopped = true;
    });
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(store.get("guild")?.message_id).toBeNull();
  });

  it("records permission failures without degrading health and retries after an hour", async () => {
    const { scheduler, store, reporter } = await createFixture();
    const publish = vi.fn<() => Promise<string>>(() =>
      Promise.reject(
        new ScheduleRefreshError("Missing Send Messages", "schedule_channel_permissions"),
      ),
    );
    const worker = scheduler(publish);
    worker.start();
    await worker.tick();
    await worker.tick();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(store.get("guild")).toMatchObject({
      last_error: "Missing Send Messages",
      next_refresh_at: new Date(now.getTime() + 3_600_000).toISOString(),
    });
    await expect(reporter.getHealthSummary()).resolves.toMatchObject({
      ignoredCount: 1,
      status: "healthy",
    });
    vi.setSystemTime(new Date(now.getTime() + 3_600_000));
    publish.mockImplementation(() => Promise.resolve("recovered"));
    await worker.tick();
    expect(store.get("guild")).toMatchObject({
      last_error: null,
      message_id: "recovered",
    });
  });
});
