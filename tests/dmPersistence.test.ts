import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dmQueue } from "../src/database/migrations/dmQueue.js";
import { automationQueue } from "../src/database/migrations/automationQueue.js";
import { failures } from "../src/database/migrations/failures.js";
import { guildSettings } from "../src/database/migrations/guildSettings.js";
import { guildSchedule } from "../src/database/migrations/guildSchedule.js";
import { memberCache } from "../src/database/migrations/memberCache.js";
import { runRoles } from "../src/database/migrations/runRoles.js";
import type { DmDeliveryJob } from "../src/dm/deliveryTypes.js";
import { SqliteDmQueueStore } from "../src/dm/queueStore.js";
import { UserDmRateLimiter } from "../src/dm/userDmRateLimiter.js";

describe("persistent DM delivery", () => {
  const folders: string[] = [];
  const stores: SqliteDmQueueStore[] = [];
  const limiters: UserDmRateLimiter[] = [];
  afterEach(() => {
    for (const limiter of limiters.splice(0)) limiter.stop();
    for (const store of stores.splice(0)) store.close();
    for (const folder of folders.splice(0))
      rmSync(folder, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it.each([
    { ageMs: 10_000, delayMs: 0, sentInWindow: 0, label: "expired" },
    { ageMs: 1_000, delayMs: 4_000, sentInWindow: 5, label: "recent" },
  ])(
    "applies the new default window to $label persisted sends after restart",
    async ({ ageMs, delayMs, sentInWindow }) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-01T00:00:10.000Z"));
      const folder = mkdtempSync(join(tmpdir(), "fullparty-dm-window-"));
      folders.push(folder);
      const path = join(folder, "bot.sqlite");
      const payload = notificationJob(42);
      const previousStore = new SqliteDmQueueStore(path);
      try {
        for (let index = 0; index < 5; index++) {
          previousStore.recordSent("123", Date.now() - ageMs, 300_000);
        }
        previousStore.enqueue(payload);
      } finally {
        previousStore.close();
      }

      const reopened = new SqliteDmQueueStore(path);
      stores.push(reopened);
      const limiter = new UserDmRateLimiter({
        store: reopened,
        logger: createLogger(),
        startPaused: true,
      });
      limiters.push(limiter);
      const deliver = vi.fn(() => Promise.resolve({ messageId: "restored" }));
      limiter.restore(deliver);
      expect(limiter.getQueueSnapshot()).toMatchObject([
        { queueLength: 1, sentInWindow },
      ]);
      limiter.resume();

      if (delayMs > 0) {
        await vi.advanceTimersByTimeAsync(delayMs - 1);
        expect(deliver).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
      } else {
        await vi.advanceTimersByTimeAsync(0);
      }

      expect(deliver).toHaveBeenCalledExactlyOnceWith(payload);
      expect(reopened.pending()).toEqual([]);
    },
  );

  it("restores queued messages and the cooldown, without replaying sent messages", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00Z"));
    const folder = mkdtempSync(join(tmpdir(), "fullparty-dm-"));
    folders.push(folder);
    const path = join(folder, "bot.sqlite");
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const store = new SqliteDmQueueStore(path);
    const limiter = new UserDmRateLimiter({ store, logger, limit: 1, windowMs: 60_000 });
    const payload = (content: string): DmDeliveryJob => ({
      discordUserId: "123",
      message: { content, nonce: `test-${content}`, enforceNonce: true },
      metadata: {},
    });
    const firstDelivery = vi.fn(() => Promise.resolve({ messageId: "first" }));
    await expect(
      limiter.send("123", firstDelivery, payload("first")),
    ).resolves.toMatchObject({
      queued: true,
      rateLimited: false,
    });
    expect(store.pending()).toHaveLength(1);
    expect(firstDelivery).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(firstDelivery).toHaveBeenCalledOnce();
    expect(store.pending()).toEqual([]);
    await limiter.send(
      "123",
      () => Promise.resolve({ messageId: "second" }),
      payload("second"),
    );
    expect(store.pending()).toHaveLength(1);
    limiter.stop();
    await limiter.waitForIdle();
    store.close();

    const reopened = new SqliteDmQueueStore(path);
    stores.push(reopened);
    const resumed = new UserDmRateLimiter({
      store: reopened,
      logger,
      limit: 1,
      windowMs: 60_000,
      startPaused: true,
    });
    limiters.push(resumed);
    const deliver = vi.fn((job: DmDeliveryJob) =>
      Promise.resolve({ messageId: job.message.content }),
    );
    resumed.restore(deliver);
    resumed.restore(deliver);
    expect(resumed.getQueueSnapshot()).toMatchObject([
      { queueLength: 1, sentInWindow: 1 },
    ]);
    resumed.resume();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(deliver).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(deliver).toHaveBeenCalledExactlyOnceWith(payload("second"));
    expect(reopened.pending()).toEqual([]);
    resumed.stop();
    await expect(resumed.send("123", () => Promise.resolve({}))).rejects.toThrow(
      "shutting down",
    );
  });

  it("records failed jobs as terminal instead of endlessly replaying them", () => {
    const store = new SqliteDmQueueStore(":memory:");
    stores.push(store);
    const id = store.enqueue({
      discordUserId: "123",
      message: { content: "test" },
      metadata: {},
    });
    if (id === undefined) throw new Error("The first job must be accepted.");
    store.complete(id, "Cannot send messages to this user");
    expect(store.pending()).toEqual([]);
  });

  it.each([
    Object.assign(new Error("Discord unavailable"), { status: 503 }),
    new TypeError("fetch failed", {
      cause: Object.assign(new Error("socket reset"), { code: "ECONNRESET" }),
    }),
  ])(
    "retries a temporary failure without losing deduplication or recipient ordering: %s",
    async (error) => {
      vi.useFakeTimers();
      const store = new SqliteDmQueueStore(":memory:");
      stores.push(store);
      const limiter = new UserDmRateLimiter({ store, logger: createLogger() });
      limiters.push(limiter);
      const order: string[] = [];
      const deliver = vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockImplementationOnce(() => {
          order.push("first");
          return Promise.resolve({ messageId: "first" });
        });
      await limiter.send("123", deliver, notificationJob(42));
      await limiter.send(
        "123",
        () => {
          order.push("second");
          return Promise.resolve({ messageId: "second" });
        },
        notificationJob(43),
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(deliver).toHaveBeenCalledOnce();
      expect(store.pending()).toMatchObject([
        { attempts: 1, availableAt: Date.now() + 5000 },
        { attempts: 0 },
      ]);
      expect(limiter.getQueueSnapshot()).toMatchObject([
        { queueLength: 2, sentInWindow: 0 },
      ]);
      await expect(
        limiter.send("123", deliver, notificationJob(42)),
      ).resolves.toMatchObject({ duplicate: true });
      await vi.advanceTimersByTimeAsync(4999);
      expect(order).toEqual([]);
      await vi.advanceTimersByTimeAsync(2);
      expect(order).toEqual(["first", "second"]);
      expect(deliver).toHaveBeenCalledTimes(2);
      expect(store.pending()).toEqual([]);
      await expect(
        limiter.send("123", deliver, notificationJob(42)),
      ).resolves.toMatchObject({ duplicate: true });
    },
  );

  it.each([
    { code: 50007, status: 403 },
    { code: 50035, status: 400 },
    { code: 10013, status: 404 },
    { status: 401, cause: { code: "ECONNRESET" } },
  ])("does not retry a permanent Discord rejection: %j", async (details) => {
    vi.useFakeTimers();
    const store = new SqliteDmQueueStore(":memory:");
    stores.push(store);
    const limiter = new UserDmRateLimiter({ store, logger: createLogger() });
    limiters.push(limiter);
    const deliver = vi.fn(() =>
      Promise.reject(Object.assign(new Error("Discord rejected the message"), details)),
    );
    await limiter.send("123", deliver, notificationJob(42));
    await vi.runAllTimersAsync();
    expect(deliver).toHaveBeenCalledOnce();
    expect(store.pending()).toEqual([]);
  });

  it("preserves retry timing and stops before the nonce retry window expires across a restart", async () => {
    vi.useFakeTimers();
    const folder = mkdtempSync(join(tmpdir(), "fullparty-dm-retries-"));
    folders.push(folder);
    const path = join(folder, "bot.sqlite");
    const initialStore = new SqliteDmQueueStore(path);
    const initialLimiter = new UserDmRateLimiter({
      store: initialStore,
      logger: createLogger(),
    });
    const failure = Object.assign(new Error("Discord unavailable"), { status: 502 });
    const firstAttempt = vi.fn(() => Promise.reject(failure));
    await initialLimiter.send("123", firstAttempt, notificationJob(42));
    await vi.advanceTimersByTimeAsync(0);
    expect(firstAttempt).toHaveBeenCalledOnce();
    initialLimiter.stop();
    await initialLimiter.waitForIdle();
    initialStore.close();

    await vi.advanceTimersByTimeAsync(2000);
    const reopened = new SqliteDmQueueStore(path);
    stores.push(reopened);
    const resumed = new UserDmRateLimiter({ store: reopened, logger: createLogger() });
    limiters.push(resumed);
    const deliver = vi.fn(() => Promise.reject(failure));
    resumed.restore(deliver);
    await vi.advanceTimersByTimeAsync(2999);
    expect(deliver).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(deliver).toHaveBeenCalledOnce();
    expect(reopened.pending()).toMatchObject([
      { attempts: 2, availableAt: Date.now() + 30_000 },
    ]);
    await vi.advanceTimersByTimeAsync(30_000 + 120_000 + 600_000);
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(reopened.pending()).toEqual([]);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(reopened.enqueue(notificationJob(42))).toBeUndefined();
  });

  it("does not send again when recording an already delivered message fails", async () => {
    vi.useFakeTimers();
    const store = new SqliteDmQueueStore(":memory:");
    stores.push(store);
    const limiter = new UserDmRateLimiter({ store, logger: createLogger() });
    limiters.push(limiter);
    vi.spyOn(store, "recordSent").mockImplementationOnce(() => {
      throw Object.assign(new Error("Database unavailable"), { code: "ETIMEDOUT" });
    });
    const deliver = vi.fn(() => Promise.resolve({ messageId: "sent" }));
    await limiter.send("123", deliver, notificationJob(42));
    await vi.runAllTimersAsync();
    expect(deliver).toHaveBeenCalledOnce();
    expect(store.pending()).toEqual([]);
    await expect(
      limiter.send("123", deliver, notificationJob(42)),
    ).resolves.toMatchObject({ duplicate: true });
  });

  it("keeps a job queued without spending a Discord attempt when beginAttempt fails", async () => {
    vi.useFakeTimers();
    const store = new SqliteDmQueueStore(":memory:");
    stores.push(store);
    const limiter = new UserDmRateLimiter({ store, logger: createLogger() });
    limiters.push(limiter);
    const beginAttempt = vi.spyOn(store, "beginAttempt").mockImplementationOnce(() => {
      throw new Error("SQLITE_BUSY");
    });
    const complete = vi.spyOn(store, "complete");
    const deliver = vi.fn(() => Promise.resolve({ messageId: "sent" }));
    await limiter.send("123", deliver, notificationJob(42));
    await vi.advanceTimersByTimeAsync(0);
    expect(deliver).not.toHaveBeenCalled();
    expect(store.pending()).toMatchObject([{ attempts: 0 }]);
    expect(limiter.getQueueSnapshot()).toMatchObject([{ queueLength: 1 }]);
    await expect(
      limiter.send("123", deliver, notificationJob(42)),
    ).resolves.toMatchObject({ duplicate: true });
    await vi.advanceTimersByTimeAsync(4999);
    expect(deliver).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(beginAttempt).toHaveBeenCalledTimes(2);
    expect(deliver).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledOnce();
    expect(store.pending()).toEqual([]);
  });

  it("retries writing a retry schedule without spending another Discord attempt", async () => {
    vi.useFakeTimers();
    const store = new SqliteDmQueueStore(":memory:");
    stores.push(store);
    const limiter = new UserDmRateLimiter({ store, logger: createLogger() });
    limiters.push(limiter);
    const beginAttempt = vi.spyOn(store, "beginAttempt");
    const retry = vi.spyOn(store, "retry").mockImplementationOnce(() => {
      throw new Error("SQLITE_BUSY");
    });
    const deliver = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("Discord unavailable"), { status: 503 }),
      )
      .mockResolvedValueOnce({ messageId: "sent" });
    await limiter.send("123", deliver, notificationJob(42));
    await vi.advanceTimersByTimeAsync(0);
    expect(deliver).toHaveBeenCalledOnce();
    expect(store.pending()).toMatchObject([{ attempts: 1 }]);
    expect(limiter.getQueueSnapshot()).toMatchObject([{ queueLength: 1 }]);
    await vi.advanceTimersByTimeAsync(4999);
    expect(beginAttempt).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2);
    expect(retry).toHaveBeenCalledTimes(2);
    expect(beginAttempt).toHaveBeenCalledTimes(2);
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(store.pending()).toEqual([]);
  });

  it.each(["success", "permanent failure"])(
    "retries only the completion write after Discord %s",
    async (outcome) => {
      vi.useFakeTimers();
      const store = new SqliteDmQueueStore(":memory:");
      stores.push(store);
      const limiter = new UserDmRateLimiter({
        store,
        logger: createLogger(),
        windowMs: 60_000,
      });
      limiters.push(limiter);
      const beginAttempt = vi.spyOn(store, "beginAttempt");
      const complete = vi.spyOn(store, "complete").mockImplementationOnce(() => {
        throw new Error("SQLITE_BUSY");
      });
      const deliver =
        outcome === "success"
          ? vi.fn(() => Promise.resolve({ messageId: "sent" }))
          : vi.fn(() =>
              Promise.reject(
                Object.assign(new Error("Cannot send messages"), {
                  status: 403,
                  code: 50007,
                }),
              ),
            );
      await limiter.send("123", deliver, notificationJob(42));
      await vi.advanceTimersByTimeAsync(0);
      expect(deliver).toHaveBeenCalledOnce();
      expect(store.pending()).toMatchObject([{ attempts: 1 }]);
      expect(limiter.getQueueSnapshot()).toMatchObject([{ queueLength: 1 }]);
      await vi.advanceTimersByTimeAsync(5000);
      expect(complete).toHaveBeenCalledTimes(2);
      expect(beginAttempt).toHaveBeenCalledOnce();
      expect(deliver).toHaveBeenCalledOnce();
      expect(store.pending()).toEqual([]);
      const terminalWrite = complete.mock.calls[1];
      expect(terminalWrite?.[1]).toBe(
        outcome === "success" ? undefined : "Cannot send messages",
      );
      await vi.advanceTimersByTimeAsync(600_000);
      expect(deliver).toHaveBeenCalledOnce();
    },
  );

  it("restores a delayed retry, then keeps its successful delivery final after another restart", async () => {
    vi.useFakeTimers();
    const folder = mkdtempSync(join(tmpdir(), "fullparty-dm-retry-success-"));
    folders.push(folder);
    const path = join(folder, "bot.sqlite");
    const initial = new SqliteDmQueueStore(path);
    const jobId = initial.enqueue(notificationJob(42));
    if (jobId === undefined) throw new Error("The first job must be accepted.");
    initial.beginAttempt(jobId);
    initial.retry(jobId, Date.now() + 5000, "Discord unavailable");
    initial.close();

    const recovering = new SqliteDmQueueStore(path);
    const limiter = new UserDmRateLimiter({ store: recovering, logger: createLogger() });
    const deliver = vi.fn(() => Promise.resolve({ messageId: "recovered" }));
    limiter.restore(deliver);
    await vi.advanceTimersByTimeAsync(4999);
    expect(deliver).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(deliver).toHaveBeenCalledExactlyOnceWith(notificationJob(42));
    limiter.stop();
    await limiter.waitForIdle();
    recovering.close();

    const reopened = new SqliteDmQueueStore(path);
    stores.push(reopened);
    const resumed = new UserDmRateLimiter({ store: reopened, logger: createLogger() });
    limiters.push(resumed);
    resumed.restore(deliver);
    await vi.runAllTimersAsync();
    expect(deliver).toHaveBeenCalledOnce();
    expect(reopened.pending()).toEqual([]);
    await expect(
      resumed.send("123", deliver, notificationJob(42)),
    ).resolves.toMatchObject({ duplicate: true });
  });

  it("prunes retention periodically while always restoring only current cooldowns", () => {
    vi.useFakeTimers();
    const folder = mkdtempSync(join(tmpdir(), "fullparty-dm-retention-"));
    folders.push(folder);
    const path = join(folder, "bot.sqlite");
    const store = new SqliteDmQueueStore(path);
    stores.push(store);
    const inspect = new DatabaseSync(path);
    try {
      store.sentTimes(5000); // First cleanup starts the throttle window.
      const oldId = store.enqueue(notificationJob(40));
      const queuedId = store.enqueue(notificationJob(41));
      if (oldId === undefined || queuedId === undefined)
        throw new Error("Jobs must be accepted.");
      store.complete(oldId);
      inspect
        .prepare("UPDATE user_dm_jobs SET completed_at = ?")
        .run(Date.now() - 31 * 24 * 60 * 60 * 1000);
      store.recordSent("old", Date.now() - 10_000, 5000);
      store.recordSent("recent", Date.now(), 5000);
      expect(store.sentTimes(5000)).toEqual(new Map([["recent", [Date.now()]]]));
      expect(
        inspect.prepare("SELECT COUNT(*) AS count FROM user_dm_jobs").get(),
      ).toMatchObject({ count: 2 });
      expect(
        inspect.prepare("SELECT COUNT(*) AS count FROM user_dm_sent_times").get(),
      ).toMatchObject({ count: 2 });
      vi.advanceTimersByTime(5 * 60 * 1000);
      store.recordSent("new", Date.now(), 5000);
      expect(store.pending()).toMatchObject([{ id: queuedId }]);
      expect(
        inspect.prepare("SELECT COUNT(*) AS count FROM user_dm_jobs").get(),
      ).toMatchObject({ count: 1 });
      expect(
        inspect.prepare("SELECT COUNT(*) AS count FROM user_dm_sent_times").get(),
      ).toMatchObject({ count: 1 });
    } finally {
      inspect.close();
    }
  });

  it("deduplicates queued and sent notifications without queueing work or using cooldown", async () => {
    vi.useFakeTimers();
    const store = new SqliteDmQueueStore(":memory:");
    stores.push(store);
    const limiter = new UserDmRateLimiter({ store, logger: createLogger(), limit: 1 });
    limiters.push(limiter);
    const deliver = vi.fn(() => Promise.resolve({ messageId: "notification" }));
    const payload = notificationJob(42);
    const duplicate = {
      discordUserId: "123",
      duplicate: true,
      queued: false,
      rateLimited: false,
    };

    await expect(limiter.send("123", deliver, payload)).resolves.toMatchObject({
      queued: true,
    });
    const retriedDelivery = vi.fn(() => Promise.resolve({ messageId: "duplicate" }));
    await expect(limiter.send("123", retriedDelivery, payload)).resolves.toEqual(
      duplicate,
    );
    expect(store.pending()).toHaveLength(1);
    expect(limiter.getQueueSnapshot()).toMatchObject([
      { queueLength: 1, sentInWindow: 0 },
    ]);

    await vi.advanceTimersByTimeAsync(0);
    expect(deliver).toHaveBeenCalledOnce();
    expect(store.pending()).toEqual([]);
    await expect(limiter.send("123", retriedDelivery, payload)).resolves.toEqual(
      duplicate,
    );
    expect(retriedDelivery).not.toHaveBeenCalled();
    expect(limiter.getQueueSnapshot()).toMatchObject([
      { queueLength: 0, sentInWindow: 1 },
    ]);
  });

  it("keeps different recipients, delivery IDs and messages without IDs independent", () => {
    const store = new SqliteDmQueueStore(":memory:");
    stores.push(store);
    expect(store.enqueue(notificationJob(42))).toEqual(expect.any(Number));
    expect(store.enqueue(notificationJob(42))).toBeUndefined();
    expect(store.enqueue(notificationJob(43))).toEqual(expect.any(Number));
    expect(store.enqueue(notificationJob(42, "456"))).toEqual(expect.any(Number));
    const untracked: DmDeliveryJob = {
      discordUserId: "123",
      message: { content: "A regular message" },
      metadata: {},
    };
    expect(store.enqueue(untracked)).toEqual(expect.any(Number));
    expect(store.enqueue(untracked)).toEqual(expect.any(Number));
    expect(store.pending()).toHaveLength(5);
  });

  it("accepts a retry of the same delivery after Discord rejects the previous attempt", async () => {
    vi.useFakeTimers();
    const store = new SqliteDmQueueStore(":memory:");
    stores.push(store);
    const limiter = new UserDmRateLimiter({ store, logger: createLogger(), limit: 1 });
    limiters.push(limiter);
    const payload = notificationJob(42);
    const fail = vi.fn(() => Promise.reject(new Error("Cannot send messages")));
    await limiter.send("123", fail, payload);
    await vi.advanceTimersByTimeAsync(0);
    expect(fail).toHaveBeenCalledOnce();
    expect(store.pending()).toEqual([]);

    const succeed = vi.fn(() => Promise.resolve({ messageId: "retried" }));
    await expect(limiter.send("123", succeed, payload)).resolves.toMatchObject({
      queued: true,
      rateLimited: false,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(succeed).toHaveBeenCalledOnce();
    expect(store.pending()).toEqual([]);
    expect(limiter.getQueueSnapshot()).toMatchObject([{ sentInWindow: 1 }]);
  });

  it("persists deduplication across restarts and independent SQLite connections", async () => {
    vi.useFakeTimers();
    const folder = mkdtempSync(join(tmpdir(), "fullparty-dm-dedup-"));
    folders.push(folder);
    const path = join(folder, "bot.sqlite");
    const initial = new SqliteDmQueueStore(path);
    const sentId = initial.enqueue(notificationJob(42));
    if (sentId === undefined) throw new Error("The first job must be accepted.");
    initial.complete(sentId);
    initial.enqueue(notificationJob(43));
    initial.close();

    const reopened = new SqliteDmQueueStore(path);
    const separateConnection = new SqliteDmQueueStore(path);
    stores.push(reopened, separateConnection);
    expect(separateConnection.enqueue(notificationJob(42))).toBeUndefined();
    expect(separateConnection.enqueue(notificationJob(43))).toBeUndefined();
    const limiter = new UserDmRateLimiter({ store: reopened, logger: createLogger() });
    limiters.push(limiter);
    const deliver = vi.fn(() => Promise.resolve({ messageId: "restored" }));
    limiter.restore(deliver);
    await vi.advanceTimersByTimeAsync(0);
    expect(deliver).toHaveBeenCalledExactlyOnceWith(notificationJob(43));
    expect(separateConnection.enqueue(notificationJob(43))).toBeUndefined();
  });

  it("migrates existing queues without losing jobs that predate delivery IDs", () => {
    const folder = mkdtempSync(join(tmpdir(), "fullparty-dm-migration-"));
    folders.push(folder);
    const path = join(folder, "bot.sqlite");
    const oldDatabase = new DatabaseSync(path);
    const legacyPayload: DmDeliveryJob = {
      discordUserId: "123",
      message: { content: "An accepted message before the upgrade" },
      metadata: { notificationType: "assignments.designation_assigned" },
    };
    try {
      oldDatabase.exec(
        "CREATE TABLE bot_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
      );
      for (const [index, migrate] of [
        guildSettings,
        runRoles,
        automationQueue,
        memberCache,
        failures,
        dmQueue,
        guildSchedule,
      ].entries()) {
        migrate(oldDatabase);
        oldDatabase
          .prepare("INSERT INTO bot_schema_migrations VALUES (?, ?)")
          .run(index + 1, new Date().toISOString());
      }
      oldDatabase
        .prepare(
          "INSERT INTO user_dm_jobs (discord_user_id, payload_json, queued_at) VALUES (?, ?, ?)",
        )
        .run("123", JSON.stringify(legacyPayload), Date.now());
    } finally {
      oldDatabase.close();
    }

    const upgraded = new SqliteDmQueueStore(path);
    stores.push(upgraded);
    expect(upgraded.pending()).toMatchObject([{ payload: legacyPayload }]);
    expect(upgraded.enqueue(notificationJob(42))).toEqual(expect.any(Number));
    expect(upgraded.enqueue(notificationJob(42))).toBeUndefined();
    expect(upgraded.pending()).toHaveLength(2);
  });

  it("rejects acceptance when the message cannot be persisted", async () => {
    const store = new SqliteDmQueueStore(":memory:");
    stores.push(store);
    const limiter = new UserDmRateLimiter({
      store,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    limiters.push(limiter);
    vi.spyOn(store, "enqueue").mockImplementationOnce(() => {
      throw new Error("Database unavailable");
    });
    const deliver = vi.fn(() => Promise.resolve({ messageId: "test" }));

    await expect(
      limiter.send("123", deliver, {
        discordUserId: "123",
        message: { content: "test" },
        metadata: {},
      }),
    ).rejects.toThrow("Database unavailable");
    expect(deliver).not.toHaveBeenCalled();
    expect(limiter.getQueueSnapshot()).toEqual([]);
    expect(store.pending()).toEqual([]);
  });
});

function notificationJob(
  notificationDeliveryId: number,
  discordUserId = "123",
): DmDeliveryJob {
  return {
    discordUserId,
    message: {
      content: "A designation notification",
      nonce: `test-${discordUserId}-${String(notificationDeliveryId)}`,
      enforceNonce: true,
    },
    metadata: {
      eventType: "discord.notification.delivery",
      notificationType: "assignments.designation_assigned",
      notificationDeliveryId,
    },
  };
}

function createLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}
