import { SqliteAdminStore } from "@fullparty/admin";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import { PermissionFlagsBits, PermissionsBitField, type Client } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BotContext } from "../src/bot/context.js";
import { openSqliteDatabase } from "../src/database/sqlite.js";
import { FullpartyApiClient } from "../src/fullparty/client.js";
import { SqliteGuildRunRoleStore } from "../src/guildAutomation/runRoleStore.js";
import { runParticipantSyncEvent } from "../src/guildAutomation/runParticipantSyncTypes.js";
import { SqliteGuildSettingsStore } from "../src/guildSettings/store.js";
import type { FailureReporter } from "../src/health/failureReporter.js";
import { createWebhookServer, stopWebhookServer } from "../src/http/server.js";
import { LatestPayloadStore } from "../src/payloads/latestPayloadStore.js";

const data = {
  discord_guild_id: "123456789012345678",
  discord_user_id: "234567890123456789",
  nickname: "Character Name [Twintania]",
  run_id: 123,
};
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const runRoles = new SqliteGuildRunRoleStore(":memory:");
  const settings = new SqliteGuildSettingsStore(":memory:");
  const database = openSqliteDatabase(":memory:");
  const adminStore = new SqliteAdminStore(database);
  cleanup.push(
    () => {
      runRoles.close();
    },
    () => {
      settings.close();
    },
    () => {
      database.close();
    },
  );
  await settings.update(data.discord_guild_id, {
    syncDiscordNamesToFf14: true,
    botLogChannelId: "logs",
  });
  const mapping = {
    discordGuildId: data.discord_guild_id,
    runId: data.run_id,
    roleId: "345678901234567890",
    roleName: "Run: Raid 20:00 UTC",
    templateRoleId: "template",
    createdAt: "2026-10-07T12:00:00Z",
    updatedAt: "2026-10-07T12:00:00Z",
    status: "active" as const,
  };
  await runRoles.upsert(mapping);
  const role = { id: mapping.roleId, name: mapping.roleName, managed: false };
  const member = {
    nickname: null as string | null,
    displayName: "Original Name",
    manageable: true,
    roles: {
      cache: new Map([["other-role", { id: "other-role" }]]),
      add: vi.fn<(roleId: string, reason: string) => Promise<void>>(),
      remove: vi.fn(),
      set: vi.fn(),
    },
    setNickname: vi.fn<(nickname: string, reason: string) => Promise<void>>(),
  };
  member.roles.add.mockImplementation((roleId) => {
    member.roles.cache.set(roleId, { id: roleId });
    return Promise.resolve();
  });
  member.setNickname.mockImplementation((nickname) => {
    member.nickname = nickname;
    return Promise.resolve();
  });
  const bot = {
    permissions: new PermissionsBitField([
      PermissionFlagsBits.ManageRoles,
      PermissionFlagsBits.ManageNicknames,
    ]),
    roles: { highest: { comparePositionTo: vi.fn(() => 1) } },
  };
  const guild = {
    id: data.discord_guild_id,
    roles: {
      fetch: vi.fn<() => Promise<typeof role | null>>(() => Promise.resolve(role)),
      create: vi.fn(),
    },
    members: {
      fetch: vi.fn(() => Promise.resolve(member)),
      fetchMe: vi.fn(() => Promise.resolve(bot)),
    },
  };
  const sendLog = vi.fn(() => Promise.resolve({ id: "log-message" }));
  const client = {
    guilds: { fetch: vi.fn(() => Promise.resolve(guild)) },
    channels: { fetch: vi.fn(() => Promise.resolve({ send: sendLog })) },
  };
  const apiFetch = vi.fn<typeof fetch>();
  const recordFailure = vi.fn<FailureReporter["record"]>((input) =>
    Promise.resolve({
      ...input,
      id: 1,
      occurredAt: "2026-10-07T12:00:00Z",
    }),
  );
  const enqueue = vi.fn<NonNullable<BotContext["guildRunReminderQueue"]>["enqueue"]>();
  const context: BotContext = {
    adminStore,
    fullparty: new FullpartyApiClient({
      baseUrl: "https://fullparty.gg/api",
      fetcher: apiFetch,
    }),
    fullpartyWebBaseUrl: "https://fullparty.gg",
    guildSettings: settings,
    guildRunRoles: runRoles,
    guildRunReminderQueue: { enqueue },
    failureReporter: { record: recordFailure, getHealthSummary: vi.fn() },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    payloads: new LatestPayloadStore(),
  };
  const server = createWebhookServer({
    client: client as unknown as Client,
    context,
    fullpartyWebBaseUrl: context.fullpartyWebBaseUrl,
    host: "127.0.0.1",
    port: 0,
    webhookSigningSecret: "test-secret",
  });
  cleanup.push(() => stopWebhookServer(server));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server port");
  const eventUrl = `http://127.0.0.1:${String(address.port)}/events`;
  async function post(payload: unknown = data, signed = true) {
    const body = JSON.stringify({
      event: runParticipantSyncEvent,
      requestId: "participant-request",
      data: payload,
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", "test-secret")
      .update(`${timestamp}.${body}`)
      .digest("hex");
    const response = await fetch(eventUrl, {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        ...(signed
          ? {
              "x-fullparty-timestamp": timestamp,
              "x-fullparty-signature": `sha256=${signature}`,
            }
          : {}),
      },
    });
    const responseBody: unknown = await response.json();
    return { status: response.status, body: responseBody };
  }
  return {
    post,
    runRoles,
    settings,
    mapping,
    role,
    member,
    bot,
    guild,
    client,
    context,
    apiFetch,
    recordFailure,
    adminStore,
    enqueue,
    sendLog,
  };
}

describe("run participant sync webhook", () => {
  it("applies the mapped role and supplied nickname to only the requested member", async () => {
    const f = await fixture();
    await expect(f.post()).resolves.toMatchObject({
      status: 200,
      body: {
        event: runParticipantSyncEvent,
        requestId: "participant-request",
        ok: true,
        result: {
          discordGuildId: data.discord_guild_id,
          discordUserId: data.discord_user_id,
          runId: 123,
          roleId: f.role.id,
          status: "completed",
          role: { status: "updated" },
          nickname: { status: "updated" },
        },
      },
    });
    expect(f.client.guilds.fetch).toHaveBeenCalledWith(data.discord_guild_id);
    expect(f.guild.roles.fetch).toHaveBeenCalledWith(f.role.id, { force: true });
    expect(f.guild.members.fetch).toHaveBeenCalledExactlyOnceWith({
      user: data.discord_user_id,
      force: true,
    });
    expect(f.member.roles.add).toHaveBeenCalledExactlyOnceWith(
      f.role.id,
      "FullParty participant sync for run 123.",
    );
    expect(f.member.setNickname).toHaveBeenCalledExactlyOnceWith(
      data.nickname,
      "FullParty participant sync for run 123.",
    );
    expect(f.member.roles.cache.has("other-role")).toBe(true);
    expect(f.member.roles.remove).not.toHaveBeenCalled();
    expect(f.member.roles.set).not.toHaveBeenCalled();
    expect(f.guild.roles.create).not.toHaveBeenCalled();
    expect(f.apiFetch).not.toHaveBeenCalled();
    expect(f.enqueue).not.toHaveBeenCalled();
    expect(f.sendLog).toHaveBeenCalledWith(
      expect.objectContaining({ allowedMentions: { parse: [] } }),
    );
    await expect(f.adminStore.getEvents()).resolves.toContainEqual(
      expect.objectContaining({
        discordGuildId: data.discord_guild_id,
        discordUserId: data.discord_user_id,
        eventType: runParticipantSyncEvent,
      }),
    );
    await expect(f.adminStore.getAutomationRuns()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          automationType: "role_assignment",
          successCount: 1,
          status: "completed",
        }),
        expect.objectContaining({
          automationType: "nickname_sync",
          successCount: 1,
          status: "completed",
        }),
      ]),
    );
  });

  it("skips completed work on replay but applies a changed nickname", async () => {
    const f = await fixture();
    await f.post();
    await expect(f.post()).resolves.toMatchObject({
      body: {
        result: {
          status: "completed",
          role: { status: "unchanged" },
          nickname: { status: "unchanged" },
        },
      },
    });
    expect(f.member.roles.add).toHaveBeenCalledOnce();
    expect(f.member.setNickname).toHaveBeenCalledOnce();
    await expect(
      f.post({ ...data, nickname: "Another Character" }),
    ).resolves.toMatchObject({
      body: {
        result: { role: { status: "unchanged" }, nickname: { status: "updated" } },
      },
    });
    expect(f.member.setNickname).toHaveBeenLastCalledWith(
      "Another Character",
      "FullParty participant sync for run 123.",
    );
  });

  it("sets an explicit nickname even when the display name already matches", async () => {
    const f = await fixture();
    f.member.displayName = data.nickname;
    await expect(f.post()).resolves.toMatchObject({
      body: { result: { nickname: { status: "updated" } } },
    });
    expect(f.member.setNickname).toHaveBeenCalledWith(
      data.nickname,
      "FullParty participant sync for run 123.",
    );
  });

  it("honors disabled nickname syncing while still assigning the role", async () => {
    const f = await fixture();
    await f.settings.update(data.discord_guild_id, { syncDiscordNamesToFf14: false });
    await expect(f.post()).resolves.toMatchObject({
      body: {
        result: {
          status: "completed",
          role: { status: "updated" },
          nickname: { status: "skipped" },
        },
      },
    });
    expect(f.member.setNickname).not.toHaveBeenCalled();
    expect(f.member.roles.add).toHaveBeenCalledOnce();
  });

  it.each([
    "untracked run",
    "different guild",
    "deleted mapping",
    "missing Discord role",
  ])("rejects %s without creating a role or updating a nickname", async (scenario) => {
    const f = await fixture();
    const payload = { ...data };
    if (scenario === "untracked run") payload.run_id = 999;
    if (scenario === "different guild") payload.discord_guild_id = "999999999999999999";
    if (scenario === "deleted mapping")
      await f.runRoles.markDeleted(data.discord_guild_id, data.run_id);
    if (scenario === "missing Discord role") f.guild.roles.fetch.mockResolvedValue(null);
    await expect(f.post(payload)).resolves.toMatchObject({
      status: 409,
      body: {
        error:
          scenario === "missing Discord role"
            ? "run_role_unavailable"
            : "run_role_not_active",
      },
    });
    expect(f.member.roles.add).not.toHaveBeenCalled();
    expect(f.member.setNickname).not.toHaveBeenCalled();
    expect(f.guild.roles.create).not.toHaveBeenCalled();
    expect(f.apiFetch).not.toHaveBeenCalled();
  });

  it("rejects missing role storage", async () => {
    const f = await fixture();
    delete f.context.guildRunRoles;
    await expect(f.post()).resolves.toMatchObject({
      status: 503,
      body: { error: "run_role_store_not_configured" },
    });
    expect(f.member.roles.add).not.toHaveBeenCalled();
    expect(f.member.setNickname).not.toHaveBeenCalled();
  });

  it("reports a missing member without applying either update", async () => {
    const f = await fixture();
    f.guild.members.fetch.mockRejectedValueOnce({ code: 10007 });
    await expect(f.post()).resolves.toMatchObject({
      status: 404,
      body: { error: "guild_member_not_found" },
    });
    expect(f.member.roles.add).not.toHaveBeenCalled();
    expect(f.member.setNickname).not.toHaveBeenCalled();
  });

  it.each(["role", "nickname"])(
    "reports a partial result after a %s failure, and retries only unfinished work",
    async (step) => {
      const f = await fixture();
      const operation = step === "role" ? f.member.roles.add : f.member.setNickname;
      operation.mockRejectedValueOnce(
        Object.assign(new Error("Missing permissions"), { code: 50013 }),
      );
      await expect(f.post()).resolves.toMatchObject({
        status: 200,
        body: {
          result: { status: "partial", [step]: { status: "failed", errorCode: "50013" } },
        },
      });
      expect(f.member.roles.add).toHaveBeenCalledOnce();
      expect(f.member.setNickname).toHaveBeenCalledOnce();
      expect(f.recordFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          affectsHealth: false,
          discordGuildId: data.discord_guild_id,
          discordUserId: data.discord_user_id,
          runId: 123,
        }),
      );
      await expect(f.post()).resolves.toMatchObject({
        body: { result: { status: "completed", [step]: { status: "updated" } } },
      });
      expect(operation).toHaveBeenCalledTimes(2);
      expect(
        step === "role" ? f.member.setNickname : f.member.roles.add,
      ).toHaveBeenCalledOnce();
    },
  );

  it("reports failed when neither operation succeeds", async () => {
    const f = await fixture();
    f.member.roles.add.mockRejectedValueOnce(new Error("Role update failed"));
    f.member.setNickname.mockRejectedValueOnce(new Error("Nickname update failed"));
    await expect(f.post()).resolves.toMatchObject({
      body: {
        result: {
          status: "failed",
          role: { status: "failed" },
          nickname: { status: "failed" },
        },
      },
    });
    expect(f.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ affectsHealth: true }),
    );
  });

  it.each([
    ["Manage Roles", "role", "bot_missing_manage_roles"],
    ["role hierarchy", "role", "run_role_not_below_bot"],
    ["Manage Nicknames", "nickname", "bot_missing_manage_nicknames"],
    ["member hierarchy", "nickname", "member_not_manageable"],
  ])(
    "reports the %s restriction while attempting the other operation",
    async (scenario, step, errorCode) => {
      const f = await fixture();
      if (scenario === "Manage Roles")
        f.bot.permissions.remove(PermissionFlagsBits.ManageRoles);
      if (scenario === "role hierarchy")
        f.bot.roles.highest.comparePositionTo.mockReturnValue(0);
      if (scenario === "Manage Nicknames")
        f.bot.permissions.remove(PermissionFlagsBits.ManageNicknames);
      if (scenario === "member hierarchy") f.member.manageable = false;
      await expect(f.post()).resolves.toMatchObject({
        body: { result: { status: "partial", [step]: { status: "failed", errorCode } } },
      });
      expect(
        step === "role" ? f.member.roles.add : f.member.setNickname,
      ).not.toHaveBeenCalled();
      expect(
        step === "role" ? f.member.setNickname : f.member.roles.add,
      ).toHaveBeenCalledOnce();
    },
  );

  it.each([
    { discord_guild_id: "" },
    { discord_user_id: null },
    { nickname: "  " },
    { nickname: "x".repeat(33) },
    { nickname: undefined },
    { run_id: "123" },
    { run_id: 0 },
    { run_id: 1.5 },
  ])("rejects invalid data %j before any Discord request", async (invalid) => {
    const f = await fixture();
    await expect(f.post({ ...data, ...invalid })).resolves.toMatchObject({
      status: 400,
      body: { error: "invalid_payload" },
    });
    expect(f.client.guilds.fetch).not.toHaveBeenCalled();
  });

  it("requires the existing webhook signature", async () => {
    const f = await fixture();
    await expect(f.post(data, false)).resolves.toMatchObject({
      status: 401,
      body: { error: "missing_signature" },
    });
    expect(f.client.guilds.fetch).not.toHaveBeenCalled();
  });
});
