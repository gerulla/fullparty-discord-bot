import { SqliteAdminStore } from "@fullparty/admin";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import type { Client, MessageCreateOptions } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BotContext } from "../src/bot/context.js";
import { openSqliteDatabase } from "../src/database/sqlite.js";
import { adminReportEvent } from "../src/dm/adminReport.js";
import { deliverStoredDm } from "../src/dm/deliveryService.js";
import { SqliteDmQueueStore } from "../src/dm/queueStore.js";
import { UserDmRateLimiter } from "../src/dm/userDmRateLimiter.js";
import { FullpartyApiClient } from "../src/fullparty/client.js";
import { SqliteGuildSettingsStore } from "../src/guildSettings/store.js";
import { createWebhookServer, stopWebhookServer } from "../src/http/server.js";
import { LatestPayloadStore } from "../src/payloads/latestPayloadStore.js";

const ownerId = "123456789012345678";
const report = { title: "Website issue", message: "Run 123 failed to complete." };
const cleanup: (() => void | Promise<void>)[] = [];

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture(startPaused = false) {
  const database = openSqliteDatabase(":memory:");
  const adminStore = new SqliteAdminStore(database);
  const settings = new SqliteGuildSettingsStore(":memory:");
  const dmStore = new SqliteDmQueueStore(":memory:");
  cleanup.push(
    () => {
      database.close();
    },
    () => {
      settings.close();
    },
    () => {
      dmStore.close();
    },
  );
  const send = vi
    .fn<(message: MessageCreateOptions) => Promise<{ id: string }>>()
    .mockResolvedValue({ id: "report-message" });
  const fetchUser = vi.fn(() => Promise.resolve({ send }));
  const client = { users: { fetch: fetchUser } } as unknown as Client;
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const limiter = new UserDmRateLimiter({ store: dmStore, logger, startPaused });
  cleanup.push(async () => {
    limiter.stop();
    await limiter.waitForIdle();
  });
  const context: BotContext = {
    adminStore,
    payloadCommandAllowedUserId: ownerId,
    userDmRateLimiter: limiter,
    guildSettings: settings,
    fullparty: new FullpartyApiClient({ baseUrl: "https://fullparty.gg/api" }),
    fullpartyWebBaseUrl: "https://fullparty.gg",
    logger,
    payloads: new LatestPayloadStore(),
  };
  const server = createWebhookServer({
    client,
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
  const url = `http://127.0.0.1:${String(address.port)}/events`;
  async function post(
    data: unknown = report,
    signing: "valid" | "invalid" | "missing" = "valid",
  ) {
    const body = JSON.stringify({
      event: adminReportEvent,
      requestId: "issue-123",
      data,
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac(
      "sha256",
      signing === "invalid" ? "wrong-secret" : "test-secret",
    )
      .update(`${timestamp}.${body}`)
      .digest("hex");
    const response = await fetch(url, {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        ...(signing === "missing"
          ? {}
          : {
              "x-fullparty-timestamp": timestamp,
              "x-fullparty-signature": `sha256=${signature}`,
            }),
      },
    });
    const responseBody: unknown = await response.json();
    return { status: response.status, body: responseBody };
  }
  async function waitForDelivery(count = 1) {
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(count);
    });
    await limiter.waitForIdle();
  }
  return {
    post,
    client,
    context,
    adminStore,
    dmStore,
    limiter,
    send,
    fetchUser,
    logger,
    waitForDelivery,
  };
}

describe("admin report event", () => {
  it("sends an embed only to the configured owner and records delivery", async () => {
    const f = await fixture();
    await expect(
      f.post({
        title: " Website issue ",
        message: ` ${report.message} `,
        url: "https://fullparty.gg/admin/issues/123",
        discord_user_id: "different-user",
        discord_user: { id: "another-user" },
        discord_guild_id: "unrelated-guild",
      }),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        ok: true,
        event: adminReportEvent,
        requestId: "issue-123",
        result: { discordUserId: ownerId, queued: true, rateLimited: false },
      },
    });
    await f.waitForDelivery();
    expect(f.fetchUser).toHaveBeenCalledExactlyOnceWith(ownerId);
    expect(f.send).toHaveBeenCalledExactlyOnceWith({
      embeds: [
        {
          title: report.title,
          description: report.message,
          url: "https://fullparty.gg/admin/issues/123",
          color: 0xd83c3e,
          footer: { text: "FullParty admin report • ERROR" },
          timestamp: expect.any(String) as string,
        },
      ],
    });
    await expect(f.adminStore.getDmDeliveries()).resolves.toMatchObject([
      {
        discordUserId: ownerId,
        eventType: adminReportEvent,
        notificationType: "admin.report.error",
        status: "sent",
        messageId: "report-message",
      },
      { discordUserId: ownerId, status: "queued" },
    ]);
    await expect(f.adminStore.getEvents()).resolves.toMatchObject([
      {
        discordUserId: ownerId,
        discordGuildId: null,
        eventType: adminReportEvent,
        requestId: "issue-123",
        status: "accepted",
      },
    ]);
  });

  it.each(["info", "warning", "error", "critical"])(
    "renders %s reports",
    async (severity) => {
      const f = await fixture();
      await expect(f.post({ ...report, severity })).resolves.toMatchObject({
        status: 200,
      });
      await f.waitForDelivery();
      expect(f.send.mock.calls[0]?.[0]).toMatchObject({
        embeds: [
          {
            footer: { text: `FullParty admin report • ${severity.toUpperCase()}` },
          },
        ],
      });
    },
  );

  it("rejects an unconfigured owner without sending or queueing", async () => {
    const f = await fixture();
    f.context.payloadCommandAllowedUserId = undefined;
    await expect(f.post()).resolves.toMatchObject({
      status: 503,
      body: { error: "admin_report_recipient_not_configured" },
    });
    expect(f.fetchUser).not.toHaveBeenCalled();
    expect(f.dmStore.pending()).toEqual([]);
  });

  it.each(["missing", "invalid"] as const)(
    "requires a valid signature (%s)",
    async (signing) => {
      const f = await fixture();
      await expect(f.post(report, signing)).resolves.toMatchObject({ status: 401 });
      expect(f.fetchUser).not.toHaveBeenCalled();
      expect(f.dmStore.pending()).toEqual([]);
    },
  );

  it.each([
    { title: "" },
    { title: undefined },
    { title: "x".repeat(257) },
    { message: "   " },
    { message: undefined },
    { message: 123 },
    { message: "x".repeat(4097) },
    { severity: "urgent" },
    { url: "/admin/issues/123" },
    { url: "javascript:alert(1)" },
    { url: "ftp://example.com/report" },
    { url: `https://example.com/${"x".repeat(2048)}` },
  ])("rejects invalid report data %#", async (invalid) => {
    const f = await fixture();
    await expect(f.post({ ...report, ...invalid })).resolves.toMatchObject({
      status: 400,
      body: { error: "invalid_payload" },
    });
    expect(f.fetchUser).not.toHaveBeenCalled();
    expect(f.dmStore.pending()).toEqual([]);
  });

  it("accepts Discord's maximum title and description lengths", async () => {
    const f = await fixture();
    await expect(
      f.post({ title: "t".repeat(256), message: "m".repeat(4096) }),
    ).resolves.toMatchObject({ status: 200 });
    await f.waitForDelivery();
    expect(f.send).toHaveBeenCalledOnce();
  });

  it("queues a burst after the existing per-user DM allowance", async () => {
    const f = await fixture();
    await f.post();
    await f.waitForDelivery();
    await f.post();
    await f.waitForDelivery(2);
    await expect(f.post()).resolves.toMatchObject({
      status: 200,
      body: {
        result: {
          discordUserId: ownerId,
          queued: true,
          rateLimited: true,
          queuePosition: 1,
        },
      },
    });
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.dmStore.pending()).toHaveLength(1);
  });

  it("restores the serialized admin report through the existing DM queue", async () => {
    const f = await fixture(true);
    await expect(f.post({ ...report, severity: "critical" })).resolves.toMatchObject({
      status: 200,
      body: { result: { queued: true } },
    });
    expect(f.send).not.toHaveBeenCalled();
    expect(f.dmStore.pending()).toMatchObject([
      {
        payload: {
          discordUserId: ownerId,
          message: { embeds: [{ title: report.title, description: report.message }] },
          metadata: {
            eventType: adminReportEvent,
            notificationType: "admin.report.critical",
          },
        },
      },
    ]);
    f.limiter.stop();
    const resumed = new UserDmRateLimiter({
      store: f.dmStore,
      logger: f.logger,
      startPaused: true,
    });
    cleanup.push(async () => {
      resumed.stop();
      await resumed.waitForIdle();
    });
    resumed.restore((job) => deliverStoredDm(f, job));
    resumed.resume();
    await vi.waitFor(() => {
      expect(f.send).toHaveBeenCalledOnce();
    });
    await resumed.waitForIdle();
    expect(f.fetchUser).toHaveBeenCalledExactlyOnceWith(ownerId);
    expect(f.dmStore.pending()).toEqual([]);
    await expect(f.adminStore.getDmDeliveries()).resolves.toMatchObject([
      { status: "sent", notificationType: "admin.report.critical" },
      { status: "queued", notificationType: "admin.report.critical" },
    ]);
  });

  it("records Discord delivery failure after acknowledging queue acceptance", async () => {
    const f = await fixture();
    f.send.mockRejectedValueOnce(
      Object.assign(new Error("Cannot send messages to this user"), { code: 50007 }),
    );
    await expect(f.post()).resolves.toMatchObject({
      status: 200,
      body: { result: { queued: true } },
    });
    await f.waitForDelivery();
    await expect(f.adminStore.getDmDeliveries()).resolves.toMatchObject([
      {
        discordUserId: ownerId,
        status: "failed",
        errorCode: "50007",
      },
      { discordUserId: ownerId, status: "queued" },
    ]);
    expect(f.dmStore.pending()).toEqual([]);
  });
});
