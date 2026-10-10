import {
  recordFailureSafely,
  serializeFailureError,
  type FailureReporter,
} from "../health/failureReporter.js";
import type { Logger } from "../lib/logger.js";
import type { DmDeliveryJob } from "./deliveryTypes.js";
import type { DmQueueStore } from "./queueStore.js";

export type UserDmRateLimiterOptions = {
  store?: DmQueueStore;
  startPaused?: boolean;
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
  rateLimited: boolean;
};

export type UserDmDuplicateResult = {
  discordUserId: string;
  duplicate: true;
  queued: false;
  rateLimited: false;
};

export type UserDmRateLimiterResult<T extends Record<string, unknown>> =
  | (T & {
      queued: false;
      rateLimited: false;
    })
  | UserDmQueuedResult
  | UserDmDuplicateResult;

export type UserDmQueueSnapshot = {
  discordUserId: string;
  nextAttemptAt: string | null;
  queueLength: number;
  sentInWindow: number;
};

type QueuedUserDm<T extends Record<string, unknown>> = {
  attempts: number;
  availableAt: number;
  enqueuedAt: number;
  firstAttemptAt: number | null;
  nonceProtected: boolean;
  jobId?: number;
  operation: () => Promise<T>;
  pendingWrite?:
    | { kind: "retry"; availableAt: number; error: unknown }
    | {
        kind: "complete";
        outcome: { sentAt: number } | { error: unknown; uncertain?: boolean };
      };
};

const defaultLimit = 5;
const defaultWindowMs = 5_000;
const retryDelaysMs = [5_000, 30_000];
const maxAttempts = retryDelaysMs.length + 1;
const persistenceRetryDelayMs = 5_000;
// Discord only deduplicates nonces from the past few minutes. Keep retries well
// inside that period; an uncertain result must never trigger a much later resend.
const protectedRetryWindowMs = 60_000;

export class UserDmRateLimiter {
  private readonly failureReporter: FailureReporter | undefined;
  private readonly limit: number;
  private readonly logger: Logger;
  private readonly queues = new Map<string, QueuedUserDm<Record<string, unknown>>[]>();
  private readonly sentAtByUser = new Map<string, number[]>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly windowMs: number;
  private readonly processingUserIds = new Set<string>();
  private readonly store: DmQueueStore | undefined;
  private stopped = false;
  private restored = false;
  private paused: boolean;

  public constructor(options: UserDmRateLimiterOptions) {
    this.failureReporter = options.failureReporter;
    this.limit = Math.max(1, Math.floor(options.limit ?? defaultLimit));
    this.logger = options.logger;
    this.windowMs = Math.max(1000, Math.floor(options.windowMs ?? defaultWindowMs));
    this.store = options.store;
    this.paused = options.startPaused ?? false;
    for (const [id, times] of this.store?.sentTimes(this.windowMs) ?? [])
      this.sentAtByUser.set(id, times);
    this.logger.info("User DM pacing configured.", {
      limit: this.limit,
      windowMs: this.windowMs,
    });
  }

  public restore(
    processor: (job: DmDeliveryJob) => Promise<Record<string, unknown>>,
  ): void {
    if (this.restored) return;
    this.restored = true;
    for (const job of this.store?.pending() ?? []) {
      this.getQueue(job.payload.discordUserId).push({
        attempts: job.attempts,
        availableAt: job.availableAt,
        enqueuedAt: job.queuedAt,
        firstAttemptAt: job.firstAttemptAt,
        nonceProtected: Boolean(
          job.payload.message.nonce && job.payload.message.enforceNonce,
        ),
        jobId: job.id,
        operation: () => processor(job.payload),
      });
      this.scheduleDrain(job.payload.discordUserId);
    }
  }

  public resume(): void {
    this.paused = false;
    for (const id of this.queues.keys()) this.scheduleDrain(id);
  }

  public async send<T extends Record<string, unknown>>(
    discordUserId: string,
    operation: () => Promise<T>,
    payload?: DmDeliveryJob,
  ): Promise<UserDmRateLimiterResult<T>> {
    if (this.stopped) throw new Error("DM delivery is shutting down.");
    const jobId = payload ? this.store?.enqueue(payload) : undefined;
    if (payload && this.store && jobId === undefined) {
      this.logger.info("Duplicate user DM delivery skipped.", {
        discordUserId,
        notificationDeliveryId: payload.metadata.notificationDeliveryId,
      });
      return { discordUserId, duplicate: true, queued: false, rateLimited: false };
    }
    const queue = this.queues.get(discordUserId);

    // Persisted webhook jobs must acknowledge acceptance without waiting for
    // Discord. The worker handles delivery even when no cooldown is needed.
    if (
      jobId === undefined &&
      !this.paused &&
      (!queue || queue.length === 0) &&
      !this.processingUserIds.has(discordUserId) &&
      this.getAvailableDelay(discordUserId) === 0
    ) {
      return this.sendImmediately(discordUserId, operation);
    }

    const activeQueue = this.getQueue(discordUserId);
    const queuePosition = activeQueue.length + 1;
    const delayMs = this.getQueueDelay(discordUserId);

    activeQueue.push({
      attempts: 0,
      availableAt: 0,
      enqueuedAt: Date.now(),
      firstAttemptAt: null,
      nonceProtected: Boolean(payload?.message.nonce && payload.message.enforceNonce),
      ...(jobId === undefined ? {} : { jobId }),
      operation,
    });
    this.scheduleDrain(discordUserId, delayMs);
    this.logger.info("User DM queued for delivery.", {
      discordUserId,
      notificationDeliveryId: payload?.metadata.notificationDeliveryId,
      queuePosition,
      rateLimited: delayMs > 0,
      currentCooldownMs: delayMs,
    });

    return {
      discordUserId,
      nextAttemptAt: new Date(Date.now() + delayMs).toISOString(),
      queuePosition,
      queued: true,
      rateLimited: delayMs > 0,
    };
  }

  public stop(): void {
    this.stopped = true;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }

    this.timers.clear();
  }

  public async waitForIdle(): Promise<void> {
    while (this.processingUserIds.size > 0)
      await new Promise((resolve) => setTimeout(resolve, 10));
  }

  public getQueueSnapshot(): UserDmQueueSnapshot[] {
    const userIds = new Set([...this.queues.keys(), ...this.sentAtByUser.keys()]);

    return [...userIds].map((discordUserId) => {
      const delayMs = this.getQueueDelay(discordUserId);

      return {
        discordUserId,
        nextAttemptAt: delayMs > 0 ? new Date(Date.now() + delayMs).toISOString() : null,
        queueLength: this.queues.get(discordUserId)?.length ?? 0,
        sentInWindow: this.pruneSentAt(discordUserId).length,
      };
    });
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
    delayMs = this.getQueueDelay(discordUserId),
  ) {
    const queue = this.queues.get(discordUserId);

    if (
      this.stopped ||
      this.paused ||
      this.processingUserIds.has(discordUserId) ||
      !queue ||
      queue.length === 0 ||
      this.timers.has(discordUserId)
    ) {
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
    if (this.stopped) return;
    if (this.processingUserIds.has(discordUserId)) {
      return;
    }

    const delayMs = this.getQueueDelay(discordUserId);

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

    this.processingUserIds.add(discordUserId);
    let needsPersistence = true;
    try {
      // Keep Discord's outcome while retrying a failed SQLite write. Retrying
      // completion must never execute the already finished Discord operation.
      if (!queuedDm.pendingWrite) {
        if (queuedDm.attempts > 0 && !canRetryProtectedDm(queuedDm)) {
          queuedDm.pendingWrite = {
            kind: "complete",
            outcome: { error: uncertainDeliveryError(), uncertain: true },
          };
        } else if (queuedDm.attempts >= maxAttempts) {
          queuedDm.pendingWrite = {
            kind: "complete",
            outcome: { error: uncertainDeliveryError(), uncertain: true },
          };
        } else {
          const attemptStartedAt = Date.now();
          if (queuedDm.jobId !== undefined)
            this.store?.beginAttempt(queuedDm.jobId, attemptStartedAt);
          queuedDm.firstAttemptAt ??= attemptStartedAt;
          queuedDm.attempts++;
          try {
            await queuedDm.operation();
            queuedDm.pendingWrite = { kind: "complete", outcome: { sentAt: Date.now() } };
          } catch (error) {
            const retryDelay = retryDelaysMs[queuedDm.attempts - 1];
            const retryable = isRetryableDmFailure(error);
            queuedDm.pendingWrite =
              queuedDm.jobId !== undefined &&
              retryDelay !== undefined &&
              retryable &&
              canRetryProtectedDm(queuedDm, retryDelay)
                ? { kind: "retry", availableAt: Date.now() + retryDelay, error }
                : {
                    kind: "complete",
                    outcome:
                      retryable || queuedDm.attempts > 1
                        ? { error: uncertainDeliveryError(error), uncertain: true }
                        : { error },
                  };
          }
        }
      }

      const write = queuedDm.pendingWrite;
      if (write.kind === "retry") {
        if (queuedDm.jobId !== undefined)
          this.store?.retry(
            queuedDm.jobId,
            write.availableAt,
            getErrorMessage(write.error),
          );
        delete queuedDm.pendingWrite;
        queuedDm.availableAt = write.availableAt;
        this.getQueue(discordUserId).unshift(queuedDm);
        this.logger.warn("Queued user DM delivery will retry.", {
          discordUserId,
          attempt: queuedDm.attempts,
          nextAttemptAt: new Date(queuedDm.availableAt).toISOString(),
          error: serializeFailureError(write.error),
        });
        return;
      }

      const outcome = write.outcome;
      if (queuedDm.jobId !== undefined)
        this.store?.complete(
          queuedDm.jobId,
          "error" in outcome ? getErrorMessage(outcome.error) : undefined,
          "error" in outcome && outcome.uncertain === true,
        );
      needsPersistence = false;
      delete queuedDm.pendingWrite;
      if ("sentAt" in outcome) {
        this.recordSent(discordUserId, outcome.sentAt);
        this.logger.info("Queued user DM delivered.", {
          discordUserId,
          attempts: queuedDm.attempts,
          waitedMs: Date.now() - queuedDm.enqueuedAt,
        });
      } else {
        this.reportDeliveryFailure(discordUserId, queuedDm.enqueuedAt, outcome.error);
      }
    } catch (error) {
      // No Discord call follows a failed beginAttempt. Later persistence failures
      // retain pendingWrite so only that write is retried when SQLite recovers.
      if (needsPersistence && queuedDm.jobId !== undefined) {
        queuedDm.availableAt = Date.now() + persistenceRetryDelayMs;
        this.getQueue(discordUserId).unshift(queuedDm);
      }
      this.logger.warn("Unable to persist queued user DM progress.", {
        discordUserId,
        retrying: needsPersistence && queuedDm.jobId !== undefined,
        error: serializeFailureError(error),
      });
      recordFailureSafely(this.failureReporter, this.logger, {
        action: "dm_queue_persistence",
        details: { error: serializeFailureError(error) },
        discordUserId,
        message: getErrorMessage(error),
        severity: "warn",
        source: "queue",
      });
    } finally {
      this.processingUserIds.delete(discordUserId);
      this.scheduleDrain(discordUserId);
    }
  }

  private reportDeliveryFailure(
    discordUserId: string,
    enqueuedAt: number,
    error: unknown,
  ): void {
    this.logger.warn("Queued user DM delivery failed.", {
      discordUserId,
      error: serializeFailureError(error),
    });
    recordFailureSafely(this.failureReporter, this.logger, {
      action: "queued_dm_delivery",
      affectsHealth: !isExpectedUserDmFailure(error),
      details: { error: serializeFailureError(error), waitedMs: Date.now() - enqueuedAt },
      discordUserId,
      errorCode: getDiscordErrorCode(error),
      message: getErrorMessage(error),
      severity: "warn",
      source: "discord_api",
    });
  }

  private getQueueDelay(discordUserId: string): number {
    const availableAt = this.queues.get(discordUserId)?.[0]?.availableAt ?? 0;
    return Math.max(this.getAvailableDelay(discordUserId), availableAt - Date.now(), 0);
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

  private recordSent(discordUserId: string, timestamp = Date.now()): void {
    const sentAt = this.pruneSentAt(discordUserId);

    sentAt.push(timestamp);
    this.sentAtByUser.set(discordUserId, sentAt);
    this.store?.recordSent(discordUserId, timestamp, this.windowMs);
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

function canRetryProtectedDm(
  job: QueuedUserDm<Record<string, unknown>>,
  delayMs = 0,
): boolean {
  if (!job.nonceProtected || job.firstAttemptAt === null) return false;
  const elapsed = Date.now() - job.firstAttemptAt;
  return elapsed >= 0 && elapsed + delayMs < protectedRetryWindowMs;
}

function uncertainDeliveryError(cause?: unknown): Error & { code: string } {
  return Object.assign(
    new Error(
      "DM delivery outcome is unknown. Automatic retries stopped to avoid duplicate messages; review delivery before resending.",
      { cause },
    ),
    { code: "DM_DELIVERY_UNCERTAIN" },
  );
}

const retryableNetworkCodes = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function isRetryableDmFailure(error: unknown, depth = 0): boolean {
  if (!isRecord(error) || depth > 4) return false;
  // A concrete HTTP rejection takes precedence over nested transport errors.
  if (typeof error.status === "number")
    return error.status === 408 || (error.status >= 500 && error.status <= 599);
  if (typeof error.code === "string" && retryableNetworkCodes.has(error.code))
    return true;
  if (error.name === "AbortError" || error.name === "TimeoutError") return true;
  return isRetryableDmFailure(error.cause, depth + 1);
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
