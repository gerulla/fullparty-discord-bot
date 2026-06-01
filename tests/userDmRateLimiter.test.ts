import { afterEach, describe, expect, it, vi } from "vitest";

import { UserDmRateLimiter } from "../src/dm/userDmRateLimiter.js";
import type { BotFailureInput, FailureReporter } from "../src/health/failureReporter.js";
import type { Logger } from "../src/lib/logger.js";

describe("UserDmRateLimiter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the first two DMs immediately and queues later DMs for the window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
    const deliveredMessages: string[] = [];
    const limiter = new UserDmRateLimiter({
      limit: 2,
      logger: createLogger(),
      windowMs: 300_000,
    });

    await expect(
      limiter.send("discord-user-id", createDelivery("first", deliveredMessages)),
    ).resolves.toMatchObject({
      messageId: "first",
      queued: false,
      rateLimited: false,
    });
    await expect(
      limiter.send("discord-user-id", createDelivery("second", deliveredMessages)),
    ).resolves.toMatchObject({
      messageId: "second",
      queued: false,
      rateLimited: false,
    });

    await expect(
      limiter.send("discord-user-id", createDelivery("third", deliveredMessages)),
    ).resolves.toEqual({
      discordUserId: "discord-user-id",
      nextAttemptAt: "2026-06-01T00:05:00.000Z",
      queuePosition: 1,
      queued: true,
      rateLimited: true,
    });
    expect(deliveredMessages).toEqual(["first", "second"]);

    await vi.advanceTimersByTimeAsync(299_999);
    expect(deliveredMessages).toEqual(["first", "second"]);

    await vi.advanceTimersByTimeAsync(1);
    expect(deliveredMessages).toEqual(["first", "second", "third"]);

    limiter.stop();
  });

  it("rate limits each Discord user independently", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
    const deliveredMessages: string[] = [];
    const limiter = new UserDmRateLimiter({
      limit: 1,
      logger: createLogger(),
      windowMs: 60_000,
    });

    await limiter.send("user-a", createDelivery("a-first", deliveredMessages));
    await limiter.send("user-b", createDelivery("b-first", deliveredMessages));
    await limiter.send("user-a", createDelivery("a-second", deliveredMessages));

    expect(deliveredMessages).toEqual(["a-first", "b-first"]);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(deliveredMessages).toEqual(["a-first", "b-first", "a-second"]);

    limiter.stop();
  });

  it("records queued DM delivery failures without counting expected user DM blocks against health", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
    const recordedFailures: BotFailureInput[] = [];
    const failureReporter: FailureReporter = {
      getHealthSummary: () => {
        throw new Error("Not used.");
      },
      record: (input) => {
        recordedFailures.push(input);

        return Promise.resolve({
          ...input,
          id: 1,
          occurredAt: "2026-06-01T00:01:00.000Z",
        });
      },
    };
    const limiter = new UserDmRateLimiter({
      failureReporter,
      limit: 1,
      logger: createLogger(),
      windowMs: 60_000,
    });

    await limiter.send("discord-user-id", () =>
      Promise.resolve({
        messageId: "first",
      }),
    );
    await limiter.send("discord-user-id", () => {
      const error = new Error("Cannot send messages to this user.") as Error & {
        code: number;
      };

      error.code = 50007;

      return Promise.reject(error);
    });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(recordedFailures).toMatchObject([
      {
        action: "queued_dm_delivery",
        affectsHealth: false,
        discordUserId: "discord-user-id",
        errorCode: "50007",
        source: "discord_api",
      },
    ]);

    limiter.stop();
  });
});

function createDelivery(messageId: string, deliveredMessages: string[]) {
  return () => {
    deliveredMessages.push(messageId);

    return Promise.resolve({
      messageId,
    });
  };
}

function createLogger(): Logger {
  return {
    debug: () => undefined,
    error: () => undefined,
    info: () => undefined,
    warn: () => undefined,
  };
}
