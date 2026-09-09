import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
      message: { content },
      metadata: {},
    });
    await limiter.send(
      "123",
      () => Promise.resolve({ messageId: "first" }),
      payload("first"),
    );
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
    store.complete(id, "Cannot send messages to this user");
    expect(store.pending()).toEqual([]);
  });
});
