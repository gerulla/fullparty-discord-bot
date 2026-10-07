import { createHmac } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Client } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BotContext } from "../src/bot/context.js";
import { FullpartyApiClient } from "../src/fullparty/client.js";
import { GuildAutomationService } from "../src/guildAutomation/automationService.js";
import { SqliteGuildRunReminderQueue } from "../src/guildAutomation/runReminderQueue.js";
import { SqliteGuildRunRoleStore } from "../src/guildAutomation/runRoleStore.js";
import { guildRunReminderDataSchema } from "../src/guildAutomation/runReminderTypes.js";
import { SqliteGuildSettingsStore } from "../src/guildSettings/store.js";
import { createWebhookServer, stopWebhookServer } from "../src/http/server.js";
import { LatestPayloadStore } from "../src/payloads/latestPayloadStore.js";

const guildId = "900100200300400500";
const malformedRoster = [
  ...Array.from({ length: 12 }, () => ({ discord_user_id: "999" })),
  {
    discord_user_id: null,
    primary_character: { name: "Character Name", world: null },
    character: { name: "", world: {} },
    source: null,
    user_id: "123",
    is_discord_linked: null,
    should_keep_group_role: "yes",
  },
];
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture(queued = false) {
  const directory = await mkdtemp(join(tmpdir(), "fullparty-cleanup-payload-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, "bot.sqlite");
  const runRoles = new SqliteGuildRunRoleStore(databasePath);
  const settings = new SqliteGuildSettingsStore(databasePath);
  cleanup.push(
    () => {
      runRoles.close();
    },
    () => {
      settings.close();
    },
  );
  const now = new Date().toISOString();
  for (const [runId, roleId] of [
    [123, "run-role"],
    [456, "other-run-role"],
  ] as const) {
    await runRoles.upsert({
      discordGuildId: guildId,
      runId,
      roleId,
      roleName: roleId,
      templateRoleId: "template-role",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  }
  const deleteRole = vi.fn(() => Promise.resolve());
  const fetchMember = vi.fn(() =>
    Promise.reject(new Error("Cleanup must not fetch participants.")),
  );
  const client = {
    guilds: {
      fetch: vi.fn(() =>
        Promise.resolve({
          members: { fetch: fetchMember },
          roles: {
            fetch: vi.fn(() =>
              Promise.resolve({
                id: "run-role",
                name: "Run: Raid 20:00 UTC",
                delete: deleteRole,
              }),
            ),
          },
        }),
      ),
    },
    channels: { fetch: vi.fn(() => Promise.resolve(null)) },
  } as unknown as Client;
  const context: BotContext = {
    guildRunRoles: runRoles,
    guildSettings: settings,
    fullparty: new FullpartyApiClient({ baseUrl: "https://fullparty.gg/api" }),
    fullpartyWebBaseUrl: "https://fullparty.gg",
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    payloads: new LatestPayloadStore(),
  };
  const automation = new GuildAutomationService({ client, context });
  const queue = queued
    ? new SqliteGuildRunReminderQueue({
        databasePath,
        logger: context.logger,
        pollIntervalMs: 250,
        processor: (job) =>
          job.kind === "run_completed"
            ? automation.complete(job.data)
            : automation.remind(job.data),
      })
    : undefined;
  if (queue) {
    context.guildRunReminderQueue = queue;
    cleanup.push(() => queue.stop());
  }
  const server = createWebhookServer({
    client,
    context,
    fullpartyWebBaseUrl: context.fullpartyWebBaseUrl,
    host: "127.0.0.1",
    port: 0,
    webhookSigningSecret: "cleanup-test-secret",
  });
  cleanup.push(() => stopWebhookServer(server));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  const url = `http://127.0.0.1:${String(address.port)}/events`;
  async function post(event: string, data: unknown) {
    const body = JSON.stringify({ event, data });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", "cleanup-test-secret")
      .update(`${timestamp}.${body}`)
      .digest("hex");
    const response = await fetch(url, {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "x-fullparty-timestamp": timestamp,
        "x-fullparty-signature": `sha256=${signature}`,
      },
    });
    const responseBody: unknown = await response.json();
    return { status: response.status, body: responseBody };
  }
  return { post, queue, databasePath, runRoles, deleteRole, fetchMember };
}

describe("run cleanup payload validation", () => {
  const rosterCases = [
    ["incomplete participant fields", malformedRoster],
    ["null roster", null],
    ["non-array roster", { entries: malformedRoster }],
    ["missing roster", undefined],
  ] as const;
  describe.each(["discord.guild.run_completed", "discord.guild.run_cancelled"])(
    "%s",
    (event) => {
      it.each(rosterCases)("cleans up with %s", async (_label, participants) => {
        const f = await fixture();
        const payload = { discord_guild_id: guildId, run_id: 123, participants };
        await expect(f.post(event, payload)).resolves.toMatchObject({
          status: 200,
          body: {
            result: {
              deletedRoleCount: 1,
              failedRoleCount: 0,
              type: event.endsWith("cancelled") ? "runs.cancelled" : "runs.completed",
            },
          },
        });
        expect(f.deleteRole).toHaveBeenCalledOnce();
        expect(f.fetchMember).not.toHaveBeenCalled();
        await expect(f.runRoles.get(guildId, 123)).resolves.toMatchObject({
          status: "deleted",
        });
        await expect(f.runRoles.get(guildId, 456)).resolves.toMatchObject({
          status: "active",
        });
        await expect(f.post(event, payload)).resolves.toMatchObject({
          status: 200,
          body: {
            result: { deletedRoleCount: 0, skippedReason: "run_role_mapping_not_found" },
          },
        });
        expect(f.deleteRole).toHaveBeenCalledOnce();
      });
    },
  );

  it("ignores malformed optional display metadata", async () => {
    const f = await fixture();
    await expect(
      f.post("discord.guild.run_completed", {
        discord_guild_id: guildId,
        run_id: 123,
        participants: malformedRoster,
        activity_id: null,
        activity_title: {},
        activity: [],
        group_id: "42",
        group_slug: null,
      }),
    ).resolves.toMatchObject({ status: 200, body: { result: { deletedRoleCount: 1 } } });
    expect(f.deleteRole).toHaveBeenCalledOnce();
  });

  it("accepts, persists, and processes cleanup without roster data in the queue", async () => {
    const f = await fixture(true);
    await expect(
      f.post("discord.guild.run_completed", {
        discord_guild_id: guildId,
        run_id: 123,
        participants: malformedRoster,
      }),
    ).resolves.toMatchObject({
      status: 200,
      body: { result: { queued: true, jobKind: "run_completed" } },
    });
    const database = new DatabaseSync(f.databasePath);
    cleanup.push(() => {
      database.close();
    });
    const before = database
      .prepare("SELECT payload_json FROM guild_run_reminder_jobs")
      .get();
    expect(before).toBeDefined();
    const persisted: unknown = JSON.parse(String(before?.payload_json));
    expect(persisted).toEqual({
      discord_guild_id: guildId,
      run_id: 123,
      type: "runs.completed",
    });

    // Simulate an older queued payload being read after a restart/deployment.
    database.prepare("UPDATE guild_run_reminder_jobs SET payload_json = ?").run(
      JSON.stringify({
        discord_guild_id: guildId,
        run_id: 123,
        type: "runs.completed",
        participants: malformedRoster,
      }),
    );
    f.queue?.start();
    await vi.waitFor(() => {
      expect(
        database.prepare("SELECT status FROM guild_run_reminder_jobs").get()?.status,
      ).toBe("completed");
    });
    expect(f.deleteRole).toHaveBeenCalledOnce();
    await expect(f.runRoles.get(guildId, 123)).resolves.toMatchObject({
      status: "deleted",
    });
  });

  it.each([
    { discord_guild_id: "" },
    { discord_guild_id: 123 },
    { discord_guild_id: undefined },
    { run_id: 0 },
    { run_id: "123" },
    { run_id: undefined },
    { type: "runs.starting_soon" },
  ])("still rejects invalid cleanup identifiers/type %j", async (invalid) => {
    const f = await fixture();
    await expect(
      f.post("discord.guild.run_completed", {
        discord_guild_id: guildId,
        run_id: 123,
        ...invalid,
      }),
    ).resolves.toMatchObject({ status: 400, body: { error: "invalid_payload" } });
    expect(f.deleteRole).not.toHaveBeenCalled();
  });

  it("keeps strict participant validation for reminder role/nickname syncing", () => {
    const result = guildRunReminderDataSchema.safeParse({
      discord_guild_id: guildId,
      run_id: 123,
      type: "runs.starting_soon",
      reminder_type: "starting_soon",
      participants: malformedRoster,
    });
    expect(result.success).toBe(false);
  });
});
