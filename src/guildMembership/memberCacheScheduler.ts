import type { Client, Guild } from "discord.js";

import {
  recordFailureSafely,
  serializeFailureError,
  type FailureReporter,
  type HealthStatus,
} from "../health/failureReporter.js";
import type { Logger } from "../lib/logger.js";
import type {
  GuildMemberCacheHealthSummary,
  GuildMemberCacheSnapshot,
  GuildMemberCacheStore,
} from "./memberCacheStore.js";

export type GuildMemberCacheRefreshReason =
  | "scheduled"
  | "member_count_changed"
  | "missing_cache"
  | "stale_cache"
  | "dashboard_request"
  | "guild_joined";

export type GuildMemberCacheSchedulerEnqueueResult = {
  alreadyQueued: boolean;
  discordGuildId: string;
  queued: boolean;
  reason: GuildMemberCacheRefreshReason;
};

export type GuildMemberCacheSchedulerHealthSummary = GuildMemberCacheHealthSummary & {
  processing: number;
  queued: number;
  running: boolean;
};

export type GuildMemberCacheSchedulerOptions = {
  client: Client;
  concurrency?: number | undefined;
  failureReporter?: FailureReporter | undefined;
  logger: Logger;
  purgeAfterMs?: number | undefined;
  refreshIntervalMs?: number | undefined;
  retryAfterMs?: number | undefined;
  store: GuildMemberCacheStore;
  sweepIntervalMs?: number | undefined;
};

type QueuedRefresh = {
  discordGuildId: string;
  reason: GuildMemberCacheRefreshReason;
};

const defaultRefreshIntervalMs = 86_400_000;
const defaultSweepIntervalMs = 300_000;
const defaultPurgeAfterMs = 604_800_000;
const defaultRetryAfterMs = 900_000;

export class GuildMemberCacheScheduler {
  private readonly client: Client;
  private readonly concurrency: number;
  private readonly failureReporter: FailureReporter | undefined;
  private readonly logger: Logger;
  private readonly purgeAfterMs: number;
  private readonly refreshIntervalMs: number;
  private readonly retryAfterMs: number;
  private readonly store: GuildMemberCacheStore;
  private readonly sweepIntervalMs: number;
  private activeRefreshCount = 0;
  private draining = false;
  private running = false;
  private sweepRunning = false;
  private timer: NodeJS.Timeout | undefined;
  private readonly activeGuildIds = new Set<string>();
  private readonly queuedGuildIds = new Set<string>();
  private readonly queue: QueuedRefresh[] = [];

  public constructor(options: GuildMemberCacheSchedulerOptions) {
    this.client = options.client;
    this.concurrency = Math.max(1, Math.floor(options.concurrency ?? 1));
    this.failureReporter = options.failureReporter;
    this.logger = options.logger;
    this.purgeAfterMs = Math.max(
      60_000,
      Math.floor(options.purgeAfterMs ?? defaultPurgeAfterMs),
    );
    this.refreshIntervalMs = Math.max(
      60_000,
      Math.floor(options.refreshIntervalMs ?? defaultRefreshIntervalMs),
    );
    this.retryAfterMs = Math.max(
      60_000,
      Math.floor(options.retryAfterMs ?? defaultRetryAfterMs),
    );
    this.store = options.store;
    this.sweepIntervalMs = Math.max(
      10_000,
      Math.floor(options.sweepIntervalMs ?? defaultSweepIntervalMs),
    );
  }

  public start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.timer = setInterval(() => {
      this.kickSweep();
    }, this.sweepIntervalMs);
    this.timer.unref();
    this.kickSweep();
    this.logger.info("Guild member cache scheduler started.", {
      concurrency: this.concurrency,
      purgeAfterMs: this.purgeAfterMs,
      refreshIntervalMs: this.refreshIntervalMs,
      sweepIntervalMs: this.sweepIntervalMs,
    });
  }

  public async stop(): Promise<void> {
    this.running = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    while (this.activeRefreshCount > 0) {
      await sleep(25);
    }
  }

  public enqueueRefresh(
    discordGuildId: string,
    reason: GuildMemberCacheRefreshReason,
  ): Promise<GuildMemberCacheSchedulerEnqueueResult> {
    if (
      this.activeGuildIds.has(discordGuildId) ||
      this.queuedGuildIds.has(discordGuildId)
    ) {
      return Promise.resolve({
        alreadyQueued: true,
        discordGuildId,
        queued: true,
        reason,
      });
    }

    this.queuedGuildIds.add(discordGuildId);
    this.queue.push({ discordGuildId, reason });
    this.kickDrain();

    return Promise.resolve({
      alreadyQueued: false,
      discordGuildId,
      queued: true,
      reason,
    });
  }

  public async getHealthSummary(): Promise<GuildMemberCacheSchedulerHealthSummary> {
    const cacheSummary = await this.store.getHealthSummary({
      staleAfterMs: this.refreshIntervalMs,
      unhealthyAfterMs: this.purgeAfterMs,
    });
    const status = getSchedulerHealthStatus(cacheSummary.status, this.running);

    return {
      ...cacheSummary,
      ok: status === "healthy",
      processing: this.activeRefreshCount,
      queued: this.queue.length,
      running: this.running,
      status,
    };
  }

  private kickSweep(): void {
    if (!this.running || this.sweepRunning) {
      return;
    }

    this.sweepRunning = true;
    void this.sweep().finally(() => {
      this.sweepRunning = false;
    });
  }

  private async sweep(): Promise<void> {
    if (!this.isClientReady()) {
      this.logger.debug("Guild member cache sweep skipped because Discord is not ready.");
      return;
    }

    await this.store.purgeExpired(new Date(Date.now() - this.purgeAfterMs));

    for (const guild of this.client.guilds.cache.values()) {
      const reason = await this.getRefreshReason(guild);

      if (reason) {
        await this.enqueueRefresh(guild.id, reason);
      }
    }
  }

  private async getRefreshReason(
    guild: Guild,
  ): Promise<GuildMemberCacheRefreshReason | undefined> {
    const snapshot = await this.store.getSnapshot(guild.id);
    const memberCount = getGuildMemberCount(guild);

    if (snapshot.lastFullRefreshAt === null) {
      return "missing_cache";
    }

    if (
      memberCount !== null &&
      snapshot.memberCount !== null &&
      memberCount !== snapshot.memberCount
    ) {
      return "member_count_changed";
    }

    if (isCacheDue(snapshot)) {
      return snapshot.refreshStatus === "failed" ? "scheduled" : "stale_cache";
    }

    return undefined;
  }

  private kickDrain(): void {
    if (this.draining) {
      return;
    }

    this.draining = true;
    queueMicrotask(() => {
      this.draining = false;
      this.drain();
    });
  }

  private drain(): void {
    while (
      this.running &&
      this.activeRefreshCount < this.concurrency &&
      this.queue.length > 0
    ) {
      const job = this.queue.shift();

      if (!job) {
        return;
      }

      this.queuedGuildIds.delete(job.discordGuildId);
      this.activeGuildIds.add(job.discordGuildId);
      this.activeRefreshCount += 1;
      void this.processRefresh(job).finally(() => {
        this.activeGuildIds.delete(job.discordGuildId);
        this.activeRefreshCount -= 1;
        this.kickDrain();
      });
    }
  }

  private async processRefresh(job: QueuedRefresh): Promise<void> {
    const guild = await this.getGuild(job.discordGuildId);

    if (!guild) {
      this.logger.warn("Guild member cache refresh skipped for unavailable guild.", {
        discordGuildId: job.discordGuildId,
        reason: job.reason,
      });
      return;
    }

    const memberCount = getGuildMemberCount(guild);
    const startedAt = new Date();

    await this.store.markRefreshStarted(guild.id, {
      memberCount,
      startedAt,
    });

    try {
      this.logger.info("Refreshing guild member cache.", {
        discordGuildId: guild.id,
        memberCount,
        reason: job.reason,
      });

      const members = await guild.members.fetch();
      const memberIds = [...members.keys()];
      const refreshedAt = new Date();

      await this.store.replaceGuildMembers(guild.id, memberIds, {
        memberCount,
        nextRefreshAfter: new Date(refreshedAt.getTime() + this.refreshIntervalMs),
        refreshedAt,
      });
      this.logger.info("Guild member cache refreshed.", {
        cachedMemberCount: memberIds.length,
        discordGuildId: guild.id,
        memberCount,
        reason: job.reason,
      });
    } catch (error) {
      await this.store.markRefreshFailed(guild.id, {
        error: getErrorMessage(error),
        failedAt: new Date(),
        memberCount,
        nextRefreshAfter: new Date(Date.now() + this.retryAfterMs),
      });
      this.logger.warn("Guild member cache refresh failed.", {
        discordGuildId: guild.id,
        error: getErrorMessage(error),
        reason: job.reason,
      });
      recordFailureSafely(this.failureReporter, this.logger, {
        action: "guild_member_cache_refresh",
        details: {
          reason: job.reason,
          serializedError: serializeFailureError(error),
        },
        discordGuildId: guild.id,
        errorCode: "guild_member_cache_refresh_failed",
        message: getErrorMessage(error),
        severity: "warn",
        source: "guild_membership",
      });
    }
  }

  private async getGuild(discordGuildId: string): Promise<Guild | undefined> {
    const cachedGuild = this.client.guilds.cache.get(discordGuildId);

    if (cachedGuild) {
      return cachedGuild;
    }

    try {
      return await this.client.guilds.fetch(discordGuildId);
    } catch {
      return undefined;
    }
  }

  private isClientReady(): boolean {
    return typeof this.client.isReady === "function" ? this.client.isReady() : true;
  }
}

function isCacheDue(snapshot: GuildMemberCacheSnapshot): boolean {
  return (
    snapshot.nextRefreshAfter === null ||
    Date.parse(snapshot.nextRefreshAfter) <= Date.now()
  );
}

function getGuildMemberCount(guild: Guild): number | null {
  return typeof guild.memberCount === "number" ? guild.memberCount : null;
}

function getSchedulerHealthStatus(
  cacheStatus: HealthStatus,
  running: boolean,
): HealthStatus {
  if (!running) {
    return "degraded";
  }

  return cacheStatus;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
