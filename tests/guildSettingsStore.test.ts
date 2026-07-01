import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { SqliteGuildSettingsStore } from "../src/guildSettings/store.js";

describe("SqliteGuildSettingsStore", () => {
  const stores: SqliteGuildSettingsStore[] = [];
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

  it("returns default settings for unknown guilds", async () => {
    const store = await createStore();

    await expect(store.get("guild-id")).resolves.toEqual({
      guildId: "guild-id",
      syncDiscordNamesToFf14: false,
    });
  });

  it("persists guild settings updates", async () => {
    const { databasePath, store } = await createStoreWithPath();

    await expect(
      store.update("guild-id", {
        botLogChannelId: "bot-log-channel-id",
        botModeratorRoleId: "bot-moderator-role-id",
        linkedAt: "2026-06-01T10:00:00.000Z",
        runAnnouncementChannelId: "run-announcement-channel-id",
        runRoleTemplateOverrides: [
          {
            activityId: 321,
            activityName: "Abyssos Savage",
            roleId: "abyssos-role-id",
          },
        ],
        syncDiscordNamesToFf14: true,
        upcomingRaiderRoleId: "upcoming-raider-role-id",
      }),
    ).resolves.toMatchObject({
      botLogChannelId: "bot-log-channel-id",
      botModeratorRoleId: "bot-moderator-role-id",
      guildId: "guild-id",
      linkedAt: "2026-06-01T10:00:00.000Z",
      runAnnouncementChannelId: "run-announcement-channel-id",
      runRoleTemplateOverrides: [
        expect.objectContaining({
          activityId: 321,
          activityName: "Abyssos Savage",
          roleId: "abyssos-role-id",
        }),
      ],
      syncDiscordNamesToFf14: true,
      upcomingRaiderRoleId: "upcoming-raider-role-id",
    });

    store.close();
    stores.splice(stores.indexOf(store), 1);

    const database = new DatabaseSync(databasePath, { readOnly: true });
    const storedSettings = database
      .prepare(
        `
          SELECT
            bot_log_channel_id,
            bot_moderator_role_id,
            guild_id,
            linked_at,
            run_announcement_channel_id,
            sync_discord_names_to_ff14,
            upcoming_raider_role_id
          FROM guild_settings
          WHERE guild_id = ?
        `,
      )
      .get("guild-id");
    const overrides = database
      .prepare(
        `
          SELECT
            activity_id,
            activity_name,
            created_at,
            role_id
          FROM guild_role_template_overrides
          WHERE guild_id = ?
        `,
      )
      .all("guild-id");

    database.close();

    expect(storedSettings).toMatchObject({
      bot_log_channel_id: "bot-log-channel-id",
      bot_moderator_role_id: "bot-moderator-role-id",
      guild_id: "guild-id",
      linked_at: "2026-06-01T10:00:00.000Z",
      run_announcement_channel_id: "run-announcement-channel-id",
      sync_discord_names_to_ff14: 1,
      upcoming_raider_role_id: "upcoming-raider-role-id",
    });
    expect(overrides).toEqual([
      {
        activity_id: 321,
        activity_name: "Abyssos Savage",
        created_at: expect.any(String) as string,
        role_id: "abyssos-role-id",
      },
    ]);
  });

  it("reads persisted settings after reopening the database", async () => {
    const { databasePath, store } = await createStoreWithPath();

    await store.update("guild-id", {
      botLogChannelId: "bot-log-channel-id",
      linkedAt: "2026-06-01T10:00:00.000Z",
      runRoleTemplateOverrides: [
        {
          activityId: 321,
          activityName: "Abyssos Savage",
          roleId: "abyssos-role-id",
        },
      ],
      syncDiscordNamesToFf14: true,
    });
    store.close();
    stores.splice(stores.indexOf(store), 1);

    const reopenedStore = new SqliteGuildSettingsStore(databasePath);
    stores.push(reopenedStore);

    await expect(reopenedStore.get("guild-id")).resolves.toMatchObject({
      botLogChannelId: "bot-log-channel-id",
      guildId: "guild-id",
      linkedAt: "2026-06-01T10:00:00.000Z",
      runRoleTemplateOverrides: [
        expect.objectContaining({
          activityId: 321,
          activityName: "Abyssos Savage",
          roleId: "abyssos-role-id",
        }),
      ],
      syncDiscordNamesToFf14: true,
    });
  });

  it("clears role template overrides when given an empty override list", async () => {
    const store = await createStore();

    await store.update("guild-id", {
      runRoleTemplateOverrides: [
        {
          activityId: 321,
          activityName: "Abyssos Savage",
          roleId: "abyssos-role-id",
        },
      ],
    });

    await expect(
      store.update("guild-id", {
        runRoleTemplateOverrides: [],
      }),
    ).resolves.toMatchObject({
      guildId: "guild-id",
      runRoleTemplateOverrides: [],
    });
    await expect(store.get("guild-id")).resolves.not.toHaveProperty(
      "runRoleTemplateOverrides",
    );
  });

  async function createStore(): Promise<SqliteGuildSettingsStore> {
    const { store } = await createStoreWithPath();

    return store;
  }

  async function createStoreWithPath(): Promise<{
    databasePath: string;
    store: SqliteGuildSettingsStore;
  }> {
    const directory = await mkdtemp(join(tmpdir(), "fullparty-settings-"));
    const databasePath = join(directory, "settings.sqlite");
    const store = new SqliteGuildSettingsStore(databasePath);

    tempDirs.push(directory);
    stores.push(store);

    return {
      databasePath,
      store,
    };
  }
});
