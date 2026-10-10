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
import { guildSchedule } from "../src/database/migrations/guildSchedule.js";

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
      legacy.exec("DELETE FROM bot_schema_migrations WHERE version IN (7, 11)");
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

  it("migrates legacy modes and shares the manual channel while preserving tracked posts", async () => {
    const { settings, path } = await createFixture();
    await settings.update("fallback", { linkedAt: now.toISOString() });
    await settings.update("disabled", { runAnnouncementChannelId: "disabled-manual" });
    const legacy = new DatabaseSync(path);
    try {
      legacy.exec("DROP TABLE guild_schedule_refresh");
      legacy.prepare("DELETE FROM bot_schema_migrations WHERE version = 11").run();
      guildSchedule(legacy);
      legacy
        .prepare(
          `INSERT INTO guild_schedule_refresh
        (guild_id, enabled, channel_id, message_id, message_channel_id, next_refresh_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "guild",
          1,
          "legacy-auto",
          "previous-post",
          "legacy-auto",
          now.toISOString(),
        );
      legacy
        .prepare(
          `INSERT INTO guild_schedule_refresh
        (guild_id, enabled, channel_id, next_refresh_at) VALUES (?, ?, ?, ?)`,
        )
        .run("fallback", 1, "fallback-auto", now.toISOString());
      legacy
        .prepare(
          `INSERT INTO guild_schedule_refresh
        (guild_id, enabled, channel_id, next_refresh_at) VALUES (?, ?, ?, ?)`,
        )
        .run("disabled", 0, "disabled-auto", now.toISOString());
    } finally {
      legacy.close();
    }
    const migrated = new SqliteGuildScheduleStore(path);
    cleanup.push(() => {
      migrated.close();
    });
    expect(migrated.get("guild")).toMatchObject({
      mode: "timed_refresh",
      channel_id: "channel",
      message_id: "previous-post",
      message_channel_id: "legacy-auto",
    });
    await expect(settings.get("fallback")).resolves.toMatchObject({
      scheduleMode: "timed_refresh",
      runAnnouncementChannelId: "fallback-auto",
      scheduleRefreshChannelId: "fallback-auto",
    });
    await expect(settings.get("disabled")).resolves.toMatchObject({
      scheduleMode: "disabled",
      runAnnouncementChannelId: "disabled-manual",
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

  it("uses one channel for both manual and automatic posts, with the explicit shared field winning", async () => {
    const { settings, store } = await createFixture();
    await expect(
      settings.update("guild", {
        runAnnouncementChannelId: "shared",
        scheduleRefreshChannelId: "old-auto",
      }),
    ).resolves.toMatchObject({
      runAnnouncementChannelId: "shared",
      scheduleRefreshChannelId: "shared",
    });
    expect(store.listDue(now)[0]?.channel_id).toBe("shared");
    await settings.update("guild", { runAnnouncementChannelId: null });
    expect(store.listDue(now)).toEqual([]);
    await expect(settings.get("guild")).resolves.not.toHaveProperty(
      "scheduleRefreshChannelId",
    );
  });

  it("preserves detection for legacy enable=true and prioritizes an explicit mode", async () => {
    const { settings } = await createFixture();
    await settings.update("guild", { scheduleMode: "run_detection" });
    await expect(
      settings.update("guild", { scheduleRefreshEnabled: true }),
    ).resolves.toMatchObject({
      scheduleMode: "run_detection",
      scheduleRefreshEnabled: true,
    });
    await expect(
      settings.update("guild", { scheduleRefreshEnabled: false }),
    ).resolves.toMatchObject({
      scheduleMode: "disabled",
      scheduleRefreshEnabled: false,
    });
    await expect(
      settings.update("guild", {
        scheduleMode: "run_detection",
        scheduleRefreshEnabled: false,
      }),
    ).resolves.toMatchObject({
      scheduleMode: "run_detection",
      scheduleRefreshEnabled: true,
    });
  });

  it("remembers an interval set before automatic scheduling is configured", async () => {
    const { settings } = await createFixture();
    await settings.update("new-guild", { scheduleRefreshIntervalDays: 7 });
    await expect(settings.get("new-guild")).resolves.toMatchObject({
      scheduleMode: "disabled",
      scheduleRefreshIntervalDays: 7,
    });
  });
});

describe("run detection schedule requests", () => {
  it("publishes initially, idles across restarts, and queues durable coalesced events", async () => {
    const { settings, store, path } = await createFixture();
    await settings.update("guild", { scheduleMode: "run_detection" });
    const initial = store.listDue(now)[0];
    if (!initial) throw new Error("Expected initial refresh");
    store.complete(initial, "initial-post", now);
    expect(store.listDue(new Date(now.getTime() + 30 * day))).toEqual([]);
    const reopened = new SqliteGuildScheduleStore(path);
    cleanup.push(() => {
      reopened.close();
    });
    expect(reopened.listDue(now)).toEqual([]);
    expect(reopened.requestRunDetectionRefresh("guild", now)).toBe(true);
    expect(reopened.requestRunDetectionRefresh("guild", now)).toBe(true);
    expect(store.listDue(now)).toHaveLength(1);
    expect(store.listDue(now)[0]).toMatchObject({
      mode: "run_detection",
      message_id: "initial-post",
      refresh_pending: 1,
    });
  });

  it.each(["timed", "disabled", "unlinked", "no-channel", "unknown"])(
    "ignores a website hint for a %s guild",
    async (state) => {
      const { settings, store } = await createFixture();
      if (state !== "timed")
        await settings.update("guild", {
          scheduleMode: state === "disabled" ? "disabled" : "run_detection",
          ...(state === "unlinked" ? { linkedAt: null } : {}),
          ...(state === "no-channel" ? { runAnnouncementChannelId: null } : {}),
        });
      expect(
        store.requestRunDetectionRefresh(state === "unknown" ? "absent" : "guild", now),
      ).toBe(false);
    },
  );

  it("keeps a newer request queued when an older fetch or send finishes", async () => {
    const { settings, store } = await createFixture();
    await settings.update("guild", { scheduleMode: "run_detection" });
    const old = store.listDue(now)[0];
    if (!old) throw new Error("Expected initial refresh");
    store.markAttempt(old, now);
    store.requestRunDetectionRefresh("guild", now);
    expect(store.isCurrent(old)).toBe(false);
    store.complete(old, "in-flight-post", now);
    const latest = store.listDue(now)[0];
    expect(latest).toMatchObject({
      refresh_pending: 1,
      message_id: "in-flight-post",
      message_channel_id: "channel",
    });
    if (!latest) throw new Error("Expected followup refresh");
    store.complete(latest, "fresh-post", now);
    expect(store.listDue(new Date(now.getTime() + 30 * day))).toEqual([]);
  });

  it("does not postpone a newer event when an outdated fetch fails", async () => {
    const { settings, store } = await createFixture();
    await settings.update("guild", { scheduleMode: "run_detection" });
    const old = store.listDue(now)[0];
    if (!old) throw new Error("Expected job");
    store.requestRunDetectionRefresh("guild", now);
    store.fail(old, "old timeout", now);
    expect(store.listDue(now)).toHaveLength(1);
    expect(store.get("guild")?.last_error).toBeNull();
  });

  it("retries failed detection jobs after one hour, then returns to idle", async () => {
    const { settings, store } = await createFixture();
    await settings.update("guild", { scheduleMode: "run_detection" });
    const job = store.listDue(now)[0];
    if (!job) throw new Error("Expected job");
    store.fail(job, "timeout", now);
    expect(store.listDue(now)).toEqual([]);
    const retryAt = new Date(now.getTime() + 3_600_000);
    const retry = store.listDue(retryAt)[0];
    if (!retry) throw new Error("Expected retry");
    store.complete(retry, "recovered-post", retryAt);
    expect(store.listDue(new Date(now.getTime() + 30 * day))).toEqual([]);
  });

  it("saves an irrelevant interval change without waking detection or canceling its pending job", async () => {
    const { settings, store } = await createFixture();
    await settings.update("guild", { scheduleMode: "run_detection" });
    const job = store.listDue(now)[0];
    if (!job) throw new Error("Expected job");
    await settings.update("guild", { scheduleRefreshIntervalDays: 7 });
    expect(store.isCurrent(job)).toBe(true);
    store.complete(job, "initial-post", now);
    await settings.update("guild", { scheduleRefreshIntervalDays: 2 });
    expect(store.listDue(new Date(now.getTime() + 30 * day))).toEqual([]);
    await expect(settings.get("guild")).resolves.toMatchObject({
      scheduleRefreshIntervalDays: 2,
    });
  });
});

describe("guild schedule scheduler", () => {
  it("suppresses the same failure warning across fresh run detection events", async () => {
    const { scheduler, settings, store, sendLog } = await createFixture();
    await settings.update("guild", {
      scheduleMode: "run_detection",
      botLogChannelId: "log-channel",
    });
    const publish = vi.fn(() => Promise.reject(new Error("Upstream timeout")));
    const worker = scheduler(publish);
    worker.start();
    await worker.tick();
    expect(store.requestRunDetectionRefresh("guild", now)).toBe(true);
    await worker.tick();
    expect(publish).toHaveBeenCalledTimes(2);
    expect(sendLog).toHaveBeenCalledTimes(1);
  });

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
