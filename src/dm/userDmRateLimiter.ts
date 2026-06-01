import {
  recordFailureSafely,
  serializeFailureError,
  type FailureReporter,
} from "../health/failureReporter.js";
import type { Logger } from "../lib/logger.js";

export type UserDmRateLimiterOptions = {
  failureReporter?: FailureReporter | undefined;
  limit?: number | undefined;
  logger: Logger;
  windowMs?: number | undefined;
};

export type UserDmQueuedResult = {
  discordUserId: string;
  nextAttemptAt: string;
  queuePosition: number;
  queued: true;
  rateLimited: true;
};

export type UserDmRateLimiterResult<T extends Record<string, unknown>> =
  | (T & {
      queued: false;
      rateLimited: false;
    })
  | UserDmQueuedResult;

type QueuedUserDm<T extends Record<string, unknown>> = {
  enqueuedAt: number;
  operation: () => Promise<T>;
};

const defaultLimit = 2;
const defaultWindowMs = 300_000;

export class UserDmRateLimiter {
  private readonly failureReporter: FailureReporter | undefined;
  private readonly limit: number;
  private readonly logger: Logger;
  private readonly queues = new Map<string, QueuedUserDm<Record<string, unknown>>[]>();
  private readonly sentAtByUser = new Map<string, number[]>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly windowMs: number;
  private readonly processingUserIds = new Set<string>();

  public constructor(options: UserDmRateLimiterOptions) {
    this.failureReporter = options.failureReporter;
    this.limit = Math.max(1, Math.floor(options.limit ?? defaultLimit));
    this.logger = options.logger;
    this.windowMs = Math.max(1000, Math.floor(options.windowMs ?? defaultWindowMs));
  }

  public async send<T extends Record<string, unknown>>(
    discordUserId: string,
    operation: () => Promise<T>,
  ): Promise<UserDmRateLimiterResult<T>> {
    const queue = this.queues.get(discordUserId);

    if (
      (!queue || queue.length === 0) &&
      !this.processingUserIds.has(discordUserId) &&
      this.getAvailableDelay(discordUserId) === 0
    ) {
      return this.sendImmediately(discordUserId, operation);
    }

    const activeQueue = this.getQueue(discordUserId);
    const queuePosition = activeQueue.length + 1;
    const delayMs = this.getAvailableDelay(discordUserId);

    activeQueue.push({
      enqueuedAt: Date.now(),
      operation,
    });
    this.scheduleDrain(discordUserId, delayMs);
    this.logger.debug("User DM rate limit reached; queued message.", {
      discordUserId,
      queuePosition,
    });

    return {
      discordUserId,
      nextAttemptAt: new Date(Date.now() + delayMs).toISOString(),
      queuePosition,
      queued: true,
      rateLimited: true,
    };
  }

  public stop(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }

    this.timers.clear();
  }

  private async sendImmediately<T extends Record<string, unknown>>(
    discordUserId: string,
    operation: () => Promise<T>,
  ): Promise<UserDmRateLimiterResult<T>> {
    this.processingUserIds.add(discordUserId);

    try {
      const result = await operation();

      this.recordSent(discordUserId);

      return {
        ...result,
        queued: false,
        rateLimited: false,
      };
    } finally {
      this.processingUserIds.delete(discordUserId);
      this.scheduleDrain(discordUserId);
    }
  }

  private scheduleDrain(
    discordUserId: string,
    delayMs = this.getAvailableDelay(discordUserId),
  ) {
    const queue = this.queues.get(discordUserId);

    if (!queue || queue.length === 0 || this.timers.has(discordUserId)) {
      return;
    }

    const timer = setTimeout(
      () => {
        this.timers.delete(discordUserId);
        void this.drain(discordUserId);
      },
      Math.max(0, delayMs),
    );

    unrefTimer(timer);
    this.timers.set(discordUserId, timer);
  }

  private async drain(discordUserId: string): Promise<void> {
    if (this.processingUserIds.has(discordUserId)) {
      return;
    }

    const delayMs = this.getAvailableDelay(discordUserId);

    if (delayMs > 0) {
      this.scheduleDrain(discordUserId, delayMs);
      return;
    }

    const queue = this.queues.get(discordUserId);
    const queuedDm = queue?.shift();

    if (!queuedDm) {
      this.queues.delete(discordUserId);
      return;
    }

    if (queue?.length === 0) {
      this.queues.delete(discordUserId);
    }

    try {
      await this.sendImmediately(discordUserId, queuedDm.operation);
      this.logger.debug("Queued user DM delivered.", {
        discordUserId,
        waitedMs: Date.now() - queuedDm.enqueuedAt,
      });
    } catch (error) {
      this.logger.warn("Queued user DM delivery failed.", {
        discordUserId,
        error: serializeFailureError(error),
      });
      recordFailureSafely(this.failureReporter, this.logger, {
        action: "queued_dm_delivery",
        affectsHealth: !isExpectedUserDmFailure(error),
        details: {
          error: serializeFailureError(error),
          waitedMs: Date.now() - queuedDm.enqueuedAt,
        },
        discordUserId,
        errorCode: getDiscordErrorCode(error),
        message: getErrorMessage(error),
        severity: "warn",
        source: "discord_api",
      });
    } finally {
      this.scheduleDrain(discordUserId);
    }
  }

  private getQueue(discordUserId: string): QueuedUserDm<Record<string, unknown>>[] {
    const queue = this.queues.get(discordUserId);

    if (queue) {
      return queue;
    }

    const newQueue: QueuedUserDm<Record<string, unknown>>[] = [];

    this.queues.set(discordUserId, newQueue);

    return newQueue;
  }

  private getAvailableDelay(discordUserId: string): number {
    const sentAt = this.pruneSentAt(discordUserId);

    if (sentAt.length < this.limit) {
      return 0;
    }

    const oldestSentAt = sentAt[0];

    if (oldestSentAt === undefined) {
      return 0;
    }

    return Math.max(0, oldestSentAt + this.windowMs - Date.now());
  }

  private recordSent(discordUserId: string): void {
    const sentAt = this.pruneSentAt(discordUserId);

    sentAt.push(Date.now());
    this.sentAtByUser.set(discordUserId, sentAt);
  }

  private pruneSentAt(discordUserId: string): number[] {
    const now = Date.now();
    const sentAt = (this.sentAtByUser.get(discordUserId) ?? []).filter(
      (timestamp) => now - timestamp < this.windowMs,
    );

    if (sentAt.length === 0) {
      this.sentAtByUser.delete(discordUserId);
      return sentAt;
    }

    this.sentAtByUser.set(discordUserId, sentAt);

    return sentAt;
  }
}

function isExpectedUserDmFailure(error: unknown): boolean {
  const errorCode = getDiscordErrorCode(error);

  return errorCode === "10013" || errorCode === "50007";
}

function getDiscordErrorCode(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const code = error.code;

  if (typeof code === "number" || typeof code === "string") {
    return String(code);
  }

  const rawError = error.rawError;

  if (isRecord(rawError)) {
    const rawCode = rawError.code;

    if (typeof rawCode === "number" || typeof rawCode === "string") {
      return String(rawCode);
    }
  }

  return undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function unrefTimer(timer: NodeJS.Timeout): void {
  if (typeof timer.unref === "function") {
    timer.unref();
  }
}
