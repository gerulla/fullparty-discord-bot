import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { SqliteGuildMemberCacheStore } from "../src/guildMembership/memberCacheStore.js";

describe("SqliteGuildMemberCacheStore", () => {
  const stores: SqliteGuildMemberCacheStore[] = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    stores.splice(0).forEach((store) => {
      store.close();
    });
    await Promise.all(
      tempDirs.splice(0).map((directory) =>
        rm(directory, {
          force: true,
          recursive: true,
        }),
      ),
    );
  });

  it("stores refreshed guild member IDs with cache freshness metadata", async () => {
    const store = await createStore();
    const refreshedAt = new Date("2026-05-30T10:00:00.000Z");

    await store.replaceGuildMembers("guild-id", ["2", "1", "2"], {
      memberCount: 2,
      nextRefreshAfter: new Date("2026-05-31T10:00:00.000Z"),
      refreshedAt,
    });

    await expect(
      store.getSnapshot("guild-id", {
        includeUserIds: true,
        now: new Date("2026-05-30T10:10:00.000Z"),
      }),
    ).resolves.toMatchObject({
      cacheAgeSeconds: 600,
      cachedMemberCount: 2,
      discordGuildId: "guild-id",
      discordUserIds: ["1", "2"],
      lastError: null,
      lastFullRefreshAt: "2026-05-30T10:00:00.000Z",
      memberCount: 2,
      nextRefreshAfter: "2026-05-31T10:00:00.000Z",
      refreshStatus: "fresh",
      stale: false,
    });

    await expect(
      store.getSnapshot("guild-id", {
        now: new Date("2026-05-31T10:00:01.000Z"),
      }),
    ).resolves.toMatchObject({
      refreshStatus: "stale",
      stale: true,
    });
  });

  it("updates cached IDs from member events and purges old rows", async () => {
    const store = await createStore();

    await store.markMemberSeen("guild-id", "1", new Date("2026-05-20T10:00:00.000Z"));
    await store.markMemberSeen("guild-id", "2", new Date("2026-05-30T10:00:00.000Z"));
    await store.markMemberRemoved("guild-id", "2", new Date("2026-05-30T10:05:00.000Z"));

    await expect(
      store.getSnapshot("guild-id", {
        includeUserIds: true,
      }),
    ).resolves.toMatchObject({
      cachedMemberCount: 1,
      discordUserIds: ["1"],
      refreshStatus: "missing",
    });

    await expect(store.purgeExpired(new Date("2026-05-27T10:00:00.000Z"))).resolves.toBe(
      1,
    );
    await expect(
      store.getSnapshot("guild-id", {
        includeUserIds: true,
      }),
    ).resolves.toMatchObject({
      cachedMemberCount: 0,
      discordUserIds: [],
    });
  });

  it("reports failed and stale cache health", async () => {
    const store = await createStore();

    await store.markRefreshFailed("guild-id", {
      error: "Missing Guild Members intent",
      failedAt: new Date("2026-05-30T10:00:00.000Z"),
      memberCount: 42,
      nextRefreshAfter: new Date("2026-05-30T10:15:00.000Z"),
    });

    await expect(
      store.getHealthSummary({
        now: new Date("2026-05-30T10:05:00.000Z"),
        staleAfterMs: 86_400_000,
        unhealthyAfterMs: 604_800_000,
      }),
    ).resolves.toMatchObject({
      cachedGuildCount: 1,
      failedGuildCount: 1,
      ok: false,
      staleGuildCount: 1,
      status: "degraded",
    });
  });

  it("keeps obsolete guild cache rows but ignores them in snapshots and health", async () => {
    const store = await createStore();

    await store.replaceGuildMembers("guild-id", ["1", "2"], {
      memberCount: 2,
      nextRefreshAfter: new Date("2026-05-31T10:00:00.000Z"),
      refreshedAt: new Date("2026-05-30T10:00:00.000Z"),
    });
    await store.markGuildObsolete(
      "guild-id",
      new Date("2026-05-30T11:00:00.000Z"),
    );

    await expect(store.listCachedGuildIds()).resolves.toEqual([]);
    await expect(
      store.getSnapshot("guild-id", {
        includeUserIds: true,
        now: new Date("2026-05-30T12:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      cachedMemberCount: 0,
      discordUserIds: [],
      refreshStatus: "missing",
    });
    await expect(
      store.getHealthSummary({
        now: new Date("2026-06-10T10:00:00.000Z"),
        staleAfterMs: 86_400_000,
        unhealthyAfterMs: 604_800_000,
      }),
    ).resolves.toMatchObject({
      cachedGuildCount: 0,
      staleGuildCount: 0,
      status: "healthy",
    });
  });

  async function createStore(): Promise<SqliteGuildMemberCacheStore> {
    const directory = await mkdtemp(join(tmpdir(), "fullparty-member-cache-"));
    const databasePath = join(directory, "member-cache.sqlite");
    const store = new SqliteGuildMemberCacheStore(databasePath);

    tempDirs.push(directory);
    stores.push(store);

    return store;
  }
});
