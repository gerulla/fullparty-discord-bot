import { createHmac } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BotContext } from "../src/bot/context.js";
import { SqliteGuildScheduleStore } from "../src/guildSchedule/store.js";
import { SqliteGuildSettingsStore } from "../src/guildSettings/store.js";
import type { GuildSettingsPatch } from "../src/guildSettings/types.js";
import { createWebhookServer, stopWebhookServer } from "../src/http/server.js";
import { LatestPayloadStore } from "../src/payloads/latestPayloadStore.js";

const guildId = "234567890123456789";
const event = {
  event: "discord.guild.runs_changed",
  data: { discord_guild_id: guildId },
};
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "fullparty-schedule-events-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "bot.sqlite");
  const settings = new SqliteGuildSettingsStore(path);
  const store = new SqliteGuildScheduleStore(path);
  cleanup.push(() => {
    settings.close();
    store.close();
  });
  await settings.update(guildId, {
    linkedAt: new Date().toISOString(),
    scheduleMode: "run_detection",
    runAnnouncementChannelId: "schedule-channel",
  });
  const initialJob = store.listDue(new Date())[0];
  if (!initialJob) throw new Error("Expected initial schedule job");
  store.complete(initialJob, "initial-post", new Date());

  const fetchRuns = vi.fn(() => new Promise<never>(() => undefined));
  const fetchChannel = vi.fn(() => new Promise<never>(() => undefined));
  const context: BotContext = {
    fullparty: {
      getDiscordGuildUpcomingRuns: fetchRuns,
    } as unknown as BotContext["fullparty"],
    fullpartyWebBaseUrl: "https://fullparty.gg",
    guildSettings: settings,
    guildScheduleStore: store,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    payloads: new LatestPayloadStore(),
  };
  const server = createWebhookServer({
    client: { channels: { fetch: fetchChannel } } as unknown as Client,
    context,
    fullpartyWebBaseUrl: "https://fullparty.gg",
    host: "127.0.0.1",
    port: 0,
    webhookSigningSecret: "test-secret",
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanup.push(() => stopWebhookServer(server));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No HTTP listener");
  const eventsUrl = `http://127.0.0.1:${String(address.port)}/events`;

  async function post(body: unknown, signed = true) {
    const rawBody = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", "test-secret")
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");
    const response = await fetch(eventsUrl, {
      method: "POST",
      body: rawBody,
      headers: {
        "content-type": "application/json",
        ...(signed
          ? {
              "x-fullparty-timestamp": timestamp,
              "x-fullparty-signature": `sha256=${signature}`,
            }
          : {}),
      },
      signal: AbortSignal.timeout(1500),
    });
    return { status: response.status, body: await response.json() };
  }
  function update(patch: Record<string, unknown>) {
    return post({
      event: "discord.guild.settings_updated",
      data: { discord_guild_id: guildId, settings: patch },
    });
  }
  return { context, path, settings, store, post, update, fetchRuns, fetchChannel };
}

describe("schedule run detection webhook", () => {
  it("acknowledges a durable refresh without waiting for Discord or FullParty", async () => {
    const f = await fixture();
    expect(f.store.listDue(new Date())).toEqual([]);
    await expect(f.post(event)).resolves.toMatchObject({
      status: 200,
      body: { ok: true, result: { discordGuildId: guildId, queued: true } },
    });
    expect(f.fetchRuns).not.toHaveBeenCalled();
    expect(f.fetchChannel).not.toHaveBeenCalled();
    const reopened = new SqliteGuildScheduleStore(f.path);
    try {
      expect(reopened.listDue(new Date())).toHaveLength(1);
      expect(reopened.listDue(new Date())[0]?.message_id).toBe("initial-post");
    } finally {
      reopened.close();
    }
  });

  it("requires the existing signature before enqueuing", async () => {
    const f = await fixture();
    await expect(f.post(event, false)).resolves.toMatchObject({
      status: 401,
      body: { error: "missing_signature" },
    });
    expect(f.store.listDue(new Date())).toEqual([]);
  });

  it.each([{}, { discord_guild_id: " " }, { discord_guild_id: 123 }])(
    "rejects malformed run-change data: %j",
    async (data) => {
      const f = await fixture();
      await expect(f.post({ ...event, data })).resolves.toMatchObject({
        status: 400,
        body: { error: "invalid_payload" },
      });
      expect(f.store.listDue(new Date())).toEqual([]);
    },
  );

  it.each<GuildSettingsPatch>([
    { scheduleMode: "disabled" },
    { scheduleMode: "timed_refresh" },
    { linkedAt: null },
    { runAnnouncementChannelId: null },
  ])("ignores events when run detection is not configured: %j", async (patch) => {
    const f = await fixture();
    await f.settings.update(guildId, patch);
    const before = f.store.get(guildId);
    await expect(f.post(event)).resolves.toMatchObject({
      status: 200,
      body: { result: { queued: false, skipped: true } },
    });
    expect(f.store.get(guildId)).toEqual(before);
  });

  it("does not create or link a guild from a run-change event", async () => {
    const f = await fixture();
    await expect(
      f.post({ ...event, data: { discord_guild_id: "unknown-guild" } }),
    ).resolves.toMatchObject({ status: 200, body: { result: { skipped: true } } });
    expect(f.store.get("unknown-guild")).toBeUndefined();
    await expect(f.settings.get("unknown-guild")).resolves.not.toHaveProperty("linkedAt");
  });

  it("asks the website to retry if durable storage is unavailable", async () => {
    const f = await fixture();
    f.context.guildScheduleStore = undefined;
    await expect(f.post(event)).resolves.toMatchObject({
      status: 503,
      body: { error: "schedule_refresh_unavailable" },
    });
  });
});

describe("schedule settings API", () => {
  it("round-trips all three modes and the single shared channel", async () => {
    const f = await fixture();
    for (const mode of ["disabled", "timed_refresh", "run_detection"] as const) {
      await expect(
        f.update({
          schedule_mode: mode,
          run_announcement_channel_id: "shared-channel",
          schedule_refresh_interval_days: 3,
        }),
      ).resolves.toMatchObject({
        status: 200,
        body: {
          result: {
            settings: {
              schedule_mode: mode,
              schedule_refresh_enabled: mode !== "disabled",
              run_announcement_channel_id: "shared-channel",
              schedule_refresh_channel_id: "shared-channel",
              schedule_refresh_interval_days: 3,
            },
          },
        },
      });
      await expect(f.settings.get(guildId)).resolves.toMatchObject({
        scheduleMode: mode,
      });
    }
  });

  it("supports legacy settings while letting explicit mode and shared channel win", async () => {
    const f = await fixture();
    await f.update({ schedule_refresh_enabled: true });
    await expect(f.settings.get(guildId)).resolves.toMatchObject({
      scheduleMode: "run_detection",
    });
    await f.update({
      schedule_refresh_enabled: false,
      schedule_refresh_channel_id: "legacy-channel",
    });
    await expect(f.settings.get(guildId)).resolves.toMatchObject({
      scheduleMode: "disabled",
      runAnnouncementChannelId: "legacy-channel",
    });
    await f.update({
      schedule_mode: "run_detection",
      schedule_refresh_enabled: false,
      run_announcement_channel_id: "shared-channel",
      schedule_refresh_channel_id: "ignored-channel",
    });
    await expect(f.settings.get(guildId)).resolves.toMatchObject({
      scheduleMode: "run_detection",
      runAnnouncementChannelId: "shared-channel",
    });
  });

  it("rejects unknown modes without changing persisted settings", async () => {
    const f = await fixture();
    const before = await f.settings.get(guildId);
    await expect(f.update({ schedule_mode: "sometimes" })).resolves.toMatchObject({
      status: 400,
      body: { error: "invalid_payload" },
    });
    expect(await f.settings.get(guildId)).toEqual(before);
  });
});
