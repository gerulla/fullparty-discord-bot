import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { MessageCreateOptions } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendUserDm, deliverStoredDm } from "../src/dm/deliveryService.js";
import { SqliteDmQueueStore } from "../src/dm/queueStore.js";
import { UserDmRateLimiter } from "../src/dm/userDmRateLimiter.js";

describe("DM nonce protection", () => {
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

  function filePath(): string {
    const folder = mkdtempSync(join(tmpdir(), "fullparty-dm-nonce-"));
    folders.push(folder);
    return join(folder, "bot.sqlite");
  }

  function fixture(path = ":memory:") {
    vi.useFakeTimers();
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const store = new SqliteDmQueueStore(path);
    stores.push(store);
    const limiter = new UserDmRateLimiter({ store, logger });
    limiters.push(limiter);
    const messages = new Map<string, string>();
    const send = vi
      .fn<(message: MessageCreateOptions) => Promise<{ id: string }>>()
      .mockImplementation((message) => {
        const nonce = String(message.nonce);
        const previous = message.enforceNonce ? messages.get(nonce) : undefined;
        if (previous) return Promise.resolve({ id: previous });
        const id = `message-${String(messages.size + 1)}`;
        messages.set(nonce, id);
        // The server created the message, but the HTTP response never reached the bot.
        return Promise.reject(
          Object.assign(new Error("Lost response"), {
            code: "UND_ERR_HEADERS_TIMEOUT",
          }),
        );
      });
    const client = { users: { fetch: vi.fn(() => Promise.resolve({ send })) } as never };
    const options = { client, context: { logger, userDmRateLimiter: limiter } };
    const enqueue = () =>
      sendUserDm(
        options,
        "123",
        { content: "One logical notification" },
        { notificationDeliveryId: 42 },
      );
    return { store, limiter, messages, send, options, enqueue, logger };
  }

  it("reuses a persisted nonce after an accepted send loses its response", async () => {
    const f = fixture();
    await f.enqueue();
    const nonce = f.store.pending()[0]?.payload.message.nonce;
    expect(nonce).toMatch(/^[a-f0-9]{24}$/u);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.store.pending()[0]?.firstAttemptAt).toBe(Date.now());
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.send).toHaveBeenCalledTimes(2);
    for (const [message] of f.send.mock.calls)
      expect(message).toMatchObject({ nonce, enforceNonce: true });
    expect(f.messages.size).toBe(1);
    expect(f.store.pending()).toEqual([]);
    await expect(f.enqueue()).resolves.toMatchObject({ duplicate: true });
  });

  it.each([2000, 65_000])(
    "preserves nonce and attempt age across a %i ms restart",
    async (restartDelay) => {
      const path = filePath();
      const f = fixture(path);
      await f.enqueue();
      await vi.advanceTimersByTimeAsync(0);
      const before = f.store.pending()[0];
      if (!before) throw new Error("Missing pending job");
      f.limiter.stop();
      await f.limiter.waitForIdle();
      f.store.close();
      stores.splice(stores.indexOf(f.store), 1);
      await vi.advanceTimersByTimeAsync(restartDelay);
      const reopened = new SqliteDmQueueStore(path);
      stores.push(reopened);
      expect(reopened.pending()[0]).toEqual(before);
      const resumed = new UserDmRateLimiter({ store: reopened, logger: f.logger });
      limiters.push(resumed);
      resumed.restore((job) => deliverStoredDm(f.options, job));
      await vi.advanceTimersByTimeAsync(Math.max(0, 5000 - restartDelay));
      expect(f.messages.size).toBe(1);
      expect(f.send).toHaveBeenCalledTimes(restartDelay < 60_000 ? 2 : 1);
      expect(reopened.pending()).toEqual([]);
      expect(reopened.enqueue(before.payload)).toBeUndefined();
      if (restartDelay >= 60_000) {
        expect(f.logger.warn).toHaveBeenCalledWith(
          "Queued user DM delivery failed.",
          expect.objectContaining({
            error: expect.objectContaining({ code: "DM_DELIVERY_UNCERTAIN" }) as unknown,
          }),
        );
        const inspect = new DatabaseSync(path);
        try {
          expect(
            inspect.prepare("SELECT status, outcome_uncertain FROM user_dm_jobs").get(),
          ).toMatchObject({ status: "failed", outcome_uncertain: 1 });
        } finally {
          inspect.close();
        }
      }
    },
  );

  it("does not resend after a delayed retry passes the short protection window", async () => {
    const f = fixture();
    await f.enqueue();
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(Date.now() + 65_000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.send).toHaveBeenCalledOnce();
    expect(f.store.pending()).toEqual([]);
    await expect(f.enqueue()).resolves.toMatchObject({ duplicate: true });
  });

  it("keeps a prior uncertain delivery reserved after a later permanent rejection", async () => {
    const f = fixture();
    await f.enqueue();
    await vi.advanceTimersByTimeAsync(0);
    f.send.mockRejectedValueOnce(
      Object.assign(new Error("DMs now blocked"), { status: 403, code: 50007 }),
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.send).toHaveBeenCalledTimes(2);
    await expect(f.enqueue()).resolves.toMatchObject({ duplicate: true });
  });

  it("only retries a delayed SQLite completion write, even beyond the send retry window", async () => {
    const f = fixture();
    f.send.mockResolvedValueOnce({ id: "sent" });
    const complete = vi.spyOn(f.store, "complete").mockImplementationOnce(() => {
      throw new Error("SQLITE_BUSY");
    });
    await f.enqueue();
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(Date.now() + 65_000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(f.send).toHaveBeenCalledOnce();
    expect(f.store.pending()).toEqual([]);
    await expect(f.enqueue()).resolves.toMatchObject({ duplicate: true });
  });

  it("does not replay a legacy attempted job without a protected nonce or start time", async () => {
    const path = filePath();
    const f = fixture(path);
    await f.enqueue();
    f.limiter.stop();
    const inspect = new DatabaseSync(path);
    try {
      inspect.exec(
        "UPDATE user_dm_jobs SET attempts = 1, first_attempt_at = NULL, payload_json = json_remove(payload_json, '$.message.nonce', '$.message.enforceNonce')",
      );
    } finally {
      inspect.close();
    }
    const resumed = new UserDmRateLimiter({ store: f.store, logger: f.logger });
    limiters.push(resumed);
    resumed.restore((job) => deliverStoredDm(f.options, job));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.send).not.toHaveBeenCalled();
    expect(f.store.pending()).toEqual([]);
    expect(
      f.store.enqueue({
        discordUserId: "123",
        message: { content: "Retry" },
        metadata: { notificationDeliveryId: 42 },
      }),
    ).toBeUndefined();
  });

  it("never invents a protected identity for a sender that supplied no nonce", async () => {
    const f = fixture();
    const payload = {
      discordUserId: "123",
      message: { content: "No nonce supplied by sender" },
      metadata: { notificationDeliveryId: 42 },
    };
    const id = f.store.enqueue(payload);
    if (id === undefined) throw new Error("Missing queued job");
    expect(f.store.pending()[0]?.payload).toEqual(payload);
    // A crash after starting the original nonce-less send leaves its outcome unknown.
    f.store.beginAttempt(id);
    f.limiter.restore((job) => deliverStoredDm(f.options, job));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.send).not.toHaveBeenCalled();
    expect(f.store.pending()).toEqual([]);
    expect(f.store.enqueue(payload)).toBeUndefined();
  });
});
