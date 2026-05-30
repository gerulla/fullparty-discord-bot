import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { SqliteGuildRunRoleStore } from "../src/guildAutomation/runRoleStore.js";

describe("SqliteGuildRunRoleStore", () => {
  const stores: SqliteGuildRunRoleStore[] = [];
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

  it("persists and deletes run role mappings", async () => {
    const store = await createStore();
    const now = new Date().toISOString();

    await store.upsert({
      createdAt: now,
      discordGuildId: "guild-id",
      roleId: "run-role-id",
      roleName: "FullParty: Run",
      runId: 123,
      status: "active",
      templateRoleId: "template-role-id",
      updatedAt: now,
    });

    await expect(store.get("guild-id", 123)).resolves.toMatchObject({
      discordGuildId: "guild-id",
      roleId: "run-role-id",
      roleName: "FullParty: Run",
      runId: 123,
      status: "active",
      templateRoleId: "template-role-id",
    });

    await store.markDeleted("guild-id", 123);

    await expect(store.get("guild-id", 123)).resolves.toMatchObject({
      status: "deleted",
    });
  });

  it("marks active mappings deleted by role id", async () => {
    const store = await createStore();
    const now = new Date().toISOString();

    await store.upsert({
      createdAt: now,
      discordGuildId: "guild-id",
      roleId: "run-role-id",
      roleName: "FullParty: Run",
      runId: 123,
      status: "active",
      templateRoleId: "template-role-id",
      updatedAt: now,
    });

    await store.markDeletedByRole("guild-id", "run-role-id");

    await expect(store.get("guild-id", 123)).resolves.toMatchObject({
      status: "deleted",
    });
  });

  async function createStore(): Promise<SqliteGuildRunRoleStore> {
    const directory = await mkdtemp(join(tmpdir(), "fullparty-run-roles-"));
    const databasePath = join(directory, "run-roles.sqlite");
    const store = new SqliteGuildRunRoleStore(databasePath);

    tempDirs.push(directory);
    stores.push(store);

    return store;
  }
});
