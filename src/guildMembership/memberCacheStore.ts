import type { DatabaseSync } from "node:sqlite";

import { openSqliteDatabase } from "../database/sqlite.js";
import type { HealthStatus } from "../health/failureReporter.js";

export type GuildMemberCacheRefreshStatus = "missing" | "refreshing" | "fresh" | "failed";

export type GuildMemberCacheSnapshotStatus = GuildMemberCacheRefreshStatus | "stale";

export type GuildMemberCacheSnapshot = {
  cacheAgeSeconds: number | null;
  cachedMemberCount: number;
  discordGuildId: string;
  discordUserIds?: string[];
  lastError: string | null;
  lastFullRefreshAt: string | null;
  memberCount: number | null;
  nextRefreshAfter: string | null;
  refreshStatus: GuildMemberCacheSnapshotStatus;
  stale: boolean;
  updatedAt: string | null;
};

export type GuildMemberCacheHealthSummary = {
  cachedGuildCount: number;
  failedGuildCount: number;
  ok: boolean;
  oldestCacheAgeSeconds: number | null;
  staleGuildCount: number;
  status: HealthStatus;
};

export type GuildMemberCacheStore = {
  close?(): void;
  deleteGuild(discordGuildId: string): Promise<void>;
  getHealthSummary(
    options: GuildMemberCacheHealthOptions,
  ): Promise<GuildMemberCacheHealthSummary>;
  getSnapshot(
    discordGuildId: string,
    options?: GuildMemberCacheSnapshotOptions,
  ): Promise<GuildMemberCacheSnapshot>;
  markMemberRemoved(
    discordGuildId: string,
    discordUserId: string,
    removedAt?: Date,
  ): Promise<void>;
  markMemberSeen(
    discordGuildId: string,
    discordUserId: string,
    seenAt?: Date,
  ): Promise<void>;
  markRefreshFailed(
    discordGuildId: string,
    options: GuildMemberCacheRefreshFailedOptions,
  ): Promise<void>;
  markRefreshStarted(
    discordGuildId: string,
    options: GuildMemberCacheRefreshStartedOptions,
  ): Promise<void>;
  purgeExpired(cutoff: Date): Promise<number>;
  replaceGuildMembers(
    discordGuildId: string,
    discordUserIds: string[],
    options: GuildMemberCacheReplaceOptions,
  ): Promise<GuildMemberCacheSnapshot>;
};

export type GuildMemberCacheSnapshotOptions = {
  includeUserIds?: boolean | undefined;
  now?: Date | undefined;
};

export type GuildMemberCacheHealthOptions = {
  now?: Date | undefined;
  staleAfterMs: number;
  unhealthyAfterMs: number;
};

export type GuildMemberCacheRefreshStartedOptions = {
  memberCount?: number | null | undefined;
  startedAt?: Date | undefined;
};

export type GuildMemberCacheRefreshFailedOptions = {
  error: string;
  failedAt?: Date | undefined;
  memberCount?: number | null | undefined;
  nextRefreshAfter: Date;
};

export type GuildMemberCacheReplaceOptions = {
  memberCount?: number | null | undefined;
  nextRefreshAfter: Date;
  refreshedAt?: Date | undefined;
};

type GuildMemberCacheStatusRow = {
  cached_member_count: number;
  discord_guild_id: string;
  last_error: string | null;
  last_full_refresh_at: string | null;
  member_count: number | null;
  next_refresh_after: string | null;
  refresh_status: GuildMemberCacheRefreshStatus;
  updated_at: string;
};

type CountRow = {
  count: number;
};

type OldestRefreshRow = {
  last_full_refresh_at: string | null;
};

type UserIdRow = {
  discord_user_id: string;
};

export class SqliteGuildMemberCacheStore implements GuildMemberCacheStore {
  private readonly database: DatabaseSync;

  public constructor(databasePath: string) {
    this.database = openSqliteDatabase(databasePath);
    this.initialize();
  }

  public getSnapshot(
    discordGuildId: string,
    options: GuildMemberCacheSnapshotOptions = {},
  ): Promise<GuildMemberCacheSnapshot> {
    const now = options.now ?? new Date();
    const row = this.getStatusRow(discordGuildId);
    const userIds = options.includeUserIds
      ? this.getGuildUserIds(discordGuildId)
      : undefined;

    if (!row) {
      const cachedMemberCount = this.getCachedMemberCount(discordGuildId);

      return Promise.resolve({
        cacheAgeSeconds: null,
        cachedMemberCount,
        discordGuildId,
        ...(userIds ? { discordUserIds: userIds } : {}),
        lastError: null,
        lastFullRefreshAt: null,
        memberCount: null,
        nextRefreshAfter: null,
        refreshStatus: "missing",
        stale: true,
        updatedAt: null,
      });
    }

    const stale =
      row.refresh_status === "fresh" &&
      row.next_refresh_after !== null &&
      Date.parse(row.next_refresh_after) <= now.getTime();
    const refreshStatus: GuildMemberCacheSnapshotStatus = stale
      ? "stale"
      : row.refresh_status;

    return Promise.resolve({
      cacheAgeSeconds: row.last_full_refresh_at
        ? Math.max(
            0,
            Math.floor((now.getTime() - Date.parse(row.last_full_refresh_at)) / 1000),
          )
        : null,
      cachedMemberCount: row.cached_member_count,
      discordGuildId: row.discord_guild_id,
      ...(userIds ? { discordUserIds: userIds } : {}),
      lastError: row.last_error,
      lastFullRefreshAt: row.last_full_refresh_at,
      memberCount: row.member_count,
      nextRefreshAfter: row.next_refresh_after,
      refreshStatus,
      stale: refreshStatus !== "fresh",
      updatedAt: row.updated_at,
    });
  }

  public markRefreshStarted(
    discordGuildId: string,
    options: GuildMemberCacheRefreshStartedOptions = {},
  ): Promise<void> {
    const startedAt = options.startedAt ?? new Date();
    const startedAtIso = startedAt.toISOString();

    this.database
      .prepare(
        `
          INSERT INTO guild_member_cache_status (
            cached_member_count,
            discord_guild_id,
            last_error,
            member_count,
            refresh_status,
            updated_at
          ) VALUES (?, ?, NULL, ?, 'refreshing', ?)
          ON CONFLICT(discord_guild_id) DO UPDATE SET
            last_error = NULL,
            member_count = excluded.member_count,
            refresh_status = 'refreshing',
            updated_at = excluded.updated_at
        `,
      )
      .run(
        this.getCachedMemberCount(discordGuildId),
        discordGuildId,
        options.memberCount ?? null,
        startedAtIso,
      );

    return Promise.resolve();
  }

  public replaceGuildMembers(
    discordGuildId: string,
    discordUserIds: string[],
    options: GuildMemberCacheReplaceOptions,
  ): Promise<GuildMemberCacheSnapshot> {
    const refreshedAt = options.refreshedAt ?? new Date();
    const refreshedAtIso = refreshedAt.toISOString();
    const uniqueUserIds = [...new Set(discordUserIds)];
    const insertMember = this.database.prepare(
      `
        INSERT INTO guild_member_cache (
          discord_guild_id,
          discord_user_id,
          refreshed_at,
          seen_at,
          source
        ) VALUES (?, ?, ?, ?, 'full_refresh')
      `,
    );

    this.database.exec("BEGIN IMMEDIATE");

    try {
      this.database
        .prepare(
          `
            DELETE FROM guild_member_cache
            WHERE discord_guild_id = ?
          `,
        )
        .run(discordGuildId);

      for (const discordUserId of uniqueUserIds) {
        insertMember.run(discordGuildId, discordUserId, refreshedAtIso, refreshedAtIso);
      }

      this.database
        .prepare(
          `
            INSERT INTO guild_member_cache_status (
              cached_member_count,
              discord_guild_id,
              last_error,
              last_full_refresh_at,
              member_count,
              next_refresh_after,
              refresh_status,
              updated_at
            ) VALUES (?, ?, NULL, ?, ?, ?, 'fresh', ?)
            ON CONFLICT(discord_guild_id) DO UPDATE SET
              cached_member_count = excluded.cached_member_count,
              last_error = NULL,
              last_full_refresh_at = excluded.last_full_refresh_at,
              member_count = excluded.member_count,
              next_refresh_after = excluded.next_refresh_after,
              refresh_status = 'fresh',
              updated_at = excluded.updated_at
          `,
        )
        .run(
          uniqueUserIds.length,
          discordGuildId,
          refreshedAtIso,
          options.memberCount ?? uniqueUserIds.length,
          options.nextRefreshAfter.toISOString(),
          refreshedAtIso,
        );

      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }

    return this.getSnapshot(discordGuildId, {
      includeUserIds: false,
      now: refreshedAt,
    });
  }

  public markRefreshFailed(
    discordGuildId: string,
    options: GuildMemberCacheRefreshFailedOptions,
  ): Promise<void> {
    const failedAt = options.failedAt ?? new Date();
    const failedAtIso = failedAt.toISOString();

    this.database
      .prepare(
        `
          INSERT INTO guild_member_cache_status (
            cached_member_count,
            discord_guild_id,
            last_error,
            member_count,
            next_refresh_after,
            refresh_status,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, 'failed', ?)
          ON CONFLICT(discord_guild_id) DO UPDATE SET
            cached_member_count = excluded.cached_member_count,
            last_error = excluded.last_error,
            member_count = excluded.member_count,
            next_refresh_after = excluded.next_refresh_after,
            refresh_status = 'failed',
            updated_at = excluded.updated_at
        `,
      )
      .run(
        this.getCachedMemberCount(discordGuildId),
        discordGuildId,
        options.error,
        options.memberCount ?? null,
        options.nextRefreshAfter.toISOString(),
        failedAtIso,
      );

    return Promise.resolve();
  }

  public markMemberSeen(
    discordGuildId: string,
    discordUserId: string,
    seenAt: Date = new Date(),
  ): Promise<void> {
    const seenAtIso = seenAt.toISOString();

    this.database
      .prepare(
        `
          INSERT INTO guild_member_cache (
            discord_guild_id,
            discord_user_id,
            refreshed_at,
            seen_at,
            source
          ) VALUES (?, ?, ?, ?, 'member_event')
          ON CONFLICT(discord_guild_id, discord_user_id) DO UPDATE SET
            refreshed_at = excluded.refreshed_at,
            seen_at = excluded.seen_at,
            source = excluded.source
        `,
      )
      .run(discordGuildId, discordUserId, seenAtIso, seenAtIso);
    this.syncStatusCachedCount(discordGuildId, seenAt);

    return Promise.resolve();
  }

  public markMemberRemoved(
    discordGuildId: string,
    discordUserId: string,
    removedAt: Date = new Date(),
  ): Promise<void> {
    this.database
      .prepare(
        `
          DELETE FROM guild_member_cache
          WHERE discord_guild_id = ?
            AND discord_user_id = ?
        `,
      )
      .run(discordGuildId, discordUserId);
    this.syncStatusCachedCount(discordGuildId, removedAt);

    return Promise.resolve();
  }

  public deleteGuild(discordGuildId: string): Promise<void> {
    this.database
      .prepare(
        `
          DELETE FROM guild_member_cache
          WHERE discord_guild_id = ?
        `,
      )
      .run(discordGuildId);
    this.database
      .prepare(
        `
          DELETE FROM guild_member_cache_status
          WHERE discord_guild_id = ?
        `,
      )
      .run(discordGuildId);

    return Promise.resolve();
  }

  public purgeExpired(cutoff: Date): Promise<number> {
    const cutoffIso = cutoff.toISOString();
    const guildRows = this.database
      .prepare(
        `
          SELECT DISTINCT discord_guild_id
          FROM guild_member_cache
          WHERE refreshed_at < ?
        `,
      )
      .all(cutoffIso) as { discord_guild_id: string }[];
    const result = this.database
      .prepare(
        `
          DELETE FROM guild_member_cache
          WHERE refreshed_at < ?
        `,
      )
      .run(cutoffIso);

    for (const row of guildRows) {
      this.syncStatusCachedCount(row.discord_guild_id, new Date());
    }

    return Promise.resolve(Number(result.changes));
  }

  public getHealthSummary(
    options: GuildMemberCacheHealthOptions,
  ): Promise<GuildMemberCacheHealthSummary> {
    const now = options.now ?? new Date();
    const staleCutoff = new Date(now.getTime() - options.staleAfterMs).toISOString();
    const unhealthyCutoff = new Date(
      now.getTime() - options.unhealthyAfterMs,
    ).toISOString();
    const cachedGuildCount = this.getStatusCount();
    const failedGuildCount = this.getStatusCount("failed");
    const staleGuildCount = this.database
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM guild_member_cache_status
          WHERE refresh_status != 'refreshing'
            AND (
              last_full_refresh_at IS NULL
              OR last_full_refresh_at < ?
              OR refresh_status = 'failed'
            )
        `,
      )
      .get(staleCutoff) as CountRow;
    const unhealthyGuildCount = this.database
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM guild_member_cache_status
          WHERE last_full_refresh_at IS NOT NULL
            AND last_full_refresh_at < ?
        `,
      )
      .get(unhealthyCutoff) as CountRow;
    const oldestRefresh = this.database
      .prepare(
        `
          SELECT MIN(last_full_refresh_at) AS last_full_refresh_at
          FROM guild_member_cache_status
          WHERE last_full_refresh_at IS NOT NULL
        `,
      )
      .get() as OldestRefreshRow;
    const oldestCacheAgeSeconds = oldestRefresh.last_full_refresh_at
      ? Math.max(
          0,
          Math.floor(
            (now.getTime() - Date.parse(oldestRefresh.last_full_refresh_at)) / 1000,
          ),
        )
      : null;
    const status = getHealthStatus({
      failedGuildCount,
      staleGuildCount: staleGuildCount.count,
      unhealthyGuildCount: unhealthyGuildCount.count,
    });

    return Promise.resolve({
      cachedGuildCount,
      failedGuildCount,
      ok: status === "healthy",
      oldestCacheAgeSeconds,
      staleGuildCount: staleGuildCount.count,
      status,
    });
  }

  public close(): void {
    this.database.close();
  }

  private initialize(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS guild_member_cache (
        discord_guild_id TEXT NOT NULL,
        discord_user_id TEXT NOT NULL,
        refreshed_at TEXT NOT NULL,
        seen_at TEXT NOT NULL,
        source TEXT NOT NULL
          CHECK (source IN ('full_refresh', 'member_event')),
        PRIMARY KEY (discord_guild_id, discord_user_id)
      )
    `);
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS guild_member_cache_guild_idx
      ON guild_member_cache (discord_guild_id)
    `);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS guild_member_cache_status (
        discord_guild_id TEXT PRIMARY KEY,
        member_count INTEGER,
        cached_member_count INTEGER NOT NULL DEFAULT 0,
        last_full_refresh_at TEXT,
        next_refresh_after TEXT,
        refresh_status TEXT NOT NULL DEFAULT 'missing'
          CHECK (refresh_status IN ('missing', 'refreshing', 'fresh', 'failed')),
        last_error TEXT,
        updated_at TEXT NOT NULL
      )
    `);
  }

  private getStatusRow(discordGuildId: string): GuildMemberCacheStatusRow | undefined {
    return this.database
      .prepare(
        `
          SELECT
            cached_member_count,
            discord_guild_id,
            last_error,
            last_full_refresh_at,
            member_count,
            next_refresh_after,
            refresh_status,
            updated_at
          FROM guild_member_cache_status
          WHERE discord_guild_id = ?
        `,
      )
      .get(discordGuildId) as GuildMemberCacheStatusRow | undefined;
  }

  private getGuildUserIds(discordGuildId: string): string[] {
    const rows = this.database
      .prepare(
        `
          SELECT discord_user_id
          FROM guild_member_cache
          WHERE discord_guild_id = ?
          ORDER BY discord_user_id ASC
        `,
      )
      .all(discordGuildId) as UserIdRow[];

    return rows.map((row) => row.discord_user_id);
  }

  private getCachedMemberCount(discordGuildId: string): number {
    const row = this.database
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM guild_member_cache
          WHERE discord_guild_id = ?
        `,
      )
      .get(discordGuildId) as CountRow;

    return row.count;
  }

  private getStatusCount(status?: GuildMemberCacheRefreshStatus): number {
    if (!status) {
      const row = this.database
        .prepare(
          `
            SELECT COUNT(*) AS count
            FROM guild_member_cache_status
          `,
        )
        .get() as CountRow;

      return row.count;
    }

    const row = this.database
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM guild_member_cache_status
          WHERE refresh_status = ?
        `,
      )
      .get(status) as CountRow;

    return row.count;
  }

  private syncStatusCachedCount(discordGuildId: string, updatedAt: Date): void {
    const cachedMemberCount = this.getCachedMemberCount(discordGuildId);
    const updatedAtIso = updatedAt.toISOString();

    this.database
      .prepare(
        `
          INSERT INTO guild_member_cache_status (
            cached_member_count,
            discord_guild_id,
            member_count,
            refresh_status,
            updated_at
          ) VALUES (?, ?, ?, 'missing', ?)
          ON CONFLICT(discord_guild_id) DO UPDATE SET
            cached_member_count = excluded.cached_member_count,
            member_count = excluded.member_count,
            updated_at = excluded.updated_at
        `,
      )
      .run(cachedMemberCount, discordGuildId, cachedMemberCount, updatedAtIso);
  }
}

function getHealthStatus(input: {
  failedGuildCount: number;
  staleGuildCount: number;
  unhealthyGuildCount: number;
}): HealthStatus {
  if (input.unhealthyGuildCount > 0) {
    return "unhealthy";
  }

  if (input.failedGuildCount > 0 || input.staleGuildCount > 0) {
    return "degraded";
  }

  return "healthy";
}
