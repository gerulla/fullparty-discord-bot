import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { GuildMemberCacheScheduler } from "../src/guildMembership/memberCacheScheduler.js";
import { SqliteGuildMemberCacheStore } from "../src/guildMembership/memberCacheStore.js";

describe("GuildMemberCacheScheduler", () => {
  const schedulers: GuildMemberCacheScheduler[] = [];
  const stores: SqliteGuildMemberCacheStore[] = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(schedulers.splice(0).map((scheduler) => scheduler.stop()));
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

  it("refreshes missing guild member caches in the background", async () => {
    const store = await createStore();
    const scheduler = createScheduler({
      guilds: [
        createGuild({
          botMemberIds: ["bot-id"],
          memberCount: 3,
          memberIds: ["1", "bot-id", "2"],
        }),
      ],
      store,
    });

    scheduler.start();
    schedulers.push(scheduler);

    await waitFor(async () => {
      const snapshot = await store.getSnapshot("guild-id", { includeUserIds: true });

      return snapshot.refreshStatus === "fresh" && snapshot.cachedMemberCount === 2;
    });

    await expect(
      store.getSnapshot("guild-id", { includeUserIds: true }),
    ).resolves.toMatchObject({
      cachedMemberCount: 2,
      discordUserIds: ["1", "2"],
      memberCount: 3,
      refreshStatus: "fresh",
    });
  });

  it("does not refresh guilds that are only installed and not linked", async () => {
    const store = await createStore();
    const scheduler = createScheduler({
      guilds: [
        createGuild({
          memberCount: 2,
          memberIds: ["1", "2"],
        }),
      ],
      linkedGuildIds: [],
      store,
    });

    scheduler.start();
    schedulers.push(scheduler);

    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });

    await expect(
      store.getSnapshot("guild-id", { includeUserIds: true }),
    ).resolves.toMatchObject({
      cachedMemberCount: 0,
      discordUserIds: [],
      refreshStatus: "missing",
    });
  });

  it("refreshes early when the Discord guild member count changes", async () => {
    const store = await createStore();

    await store.replaceGuildMembers("guild-id", ["1", "2"], {
      memberCount: 2,
      nextRefreshAfter: new Date("2026-05-31T10:00:00.000Z"),
      refreshedAt: new Date("2026-05-30T10:00:00.000Z"),
    });

    const scheduler = createScheduler({
      guilds: [
        createGuild({
          memberCount: 3,
          memberIds: ["1", "2", "3"],
        }),
      ],
      store,
    });

    scheduler.start();
    schedulers.push(scheduler);

    await waitFor(async () => {
      const snapshot = await store.getSnapshot("guild-id", { includeUserIds: true });

      return snapshot.cachedMemberCount === 3;
    });

    await expect(
      store.getSnapshot("guild-id", { includeUserIds: true }),
    ).resolves.toMatchObject({
      cachedMemberCount: 3,
      discordUserIds: ["1", "2", "3"],
      memberCount: 3,
      refreshStatus: "fresh",
    });
  });

  async function createStore(): Promise<SqliteGuildMemberCacheStore> {
    const directory = await mkdtemp(join(tmpdir(), "fullparty-member-scheduler-"));
    const databasePath = join(directory, "member-cache.sqlite");
    const store = new SqliteGuildMemberCacheStore(databasePath);

    tempDirs.push(directory);
    stores.push(store);

    return store;
  }
});

function createScheduler(options: {
  guilds: unknown[];
  linkedGuildIds?: string[];
  store: SqliteGuildMemberCacheStore;
}): GuildMemberCacheScheduler {
  const guildMap = new Map(
    options.guilds.map((guild) => [(guild as { id: string }).id, guild]),
  );
  const linkedGuildIds = new Set(options.linkedGuildIds ?? ["guild-id"]);

  return new GuildMemberCacheScheduler({
    client: {
      guilds: {
        cache: guildMap,
        fetch: (guildId: string) => Promise.resolve(guildMap.get(guildId)),
      },
      isReady: () => true,
    } as never,
    logger: {
      debug: () => undefined,
      error: () => undefined,
      info: () => undefined,
      warn: () => undefined,
    },
    refreshIntervalMs: 86_400_000,
    settingsStore: {
      get: (guildId: string) =>
        Promise.resolve({
          guildId,
          ...(linkedGuildIds.has(guildId)
            ? { linkedAt: "2026-06-01T10:00:00.000Z" }
            : {}),
          syncDiscordNamesToFf14: false,
        }),
      update: (guildId: string) =>
        Promise.resolve({ guildId, syncDiscordNamesToFf14: false }),
    },
    store: options.store,
    sweepIntervalMs: 10_000,
  });
}

function createGuild(options: {
  botMemberIds?: string[];
  memberCount: number;
  memberIds: string[];
}): unknown {
  const botMemberIds = new Set(options.botMemberIds ?? []);

  return {
    id: "guild-id",
    memberCount: options.memberCount,
    members: {
      fetch: () =>
        Promise.resolve(
          new Map(
            options.memberIds.map((memberId) => [
              memberId,
              {
                id: memberId,
                user: {
                  bot: botMemberIds.has(memberId),
                },
              },
            ]),
          ),
        ),
    },
  };
}

async function waitFor(assertion: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 1000;

  while (Date.now() < deadline) {
    if (await assertion()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }

  throw new Error("Timed out waiting for condition.");
}
