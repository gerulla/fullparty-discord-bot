import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { SqliteAdminStore } from "../src/admin/adminStore.js";

describe("SqliteAdminStore", () => {
  const stores: SqliteAdminStore[] = [];
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

  it("records and summarizes admin telemetry", async () => {
    const store = await createStore();

    await store.recordBotEvent({
      dataType: "assignments.assigned",
      discordUserId: "discord-user-id",
      eventType: "discord.notification.delivery",
      occurredAt: "2026-06-01T10:00:00.000Z",
      requestHost: "127.0.0.1",
      requestId: "event-id",
      status: "accepted",
    });
    await store.recordBotEvent({
      dataType: "runs.starting_soon",
      discordGuildId: "guild-id",
      eventType: "discord.guild.run_reminder",
      occurredAt: "2026-05-31T09:00:00.000Z",
      status: "accepted",
    });
    await store.recordDmDelivery({
      discordUserId: "discord-user-id",
      eventType: "discord.notification.delivery",
      messageId: "message-id",
      notificationType: "assignments.assigned",
      occurredAt: "2026-06-01T10:01:00.000Z",
      sentAt: "2026-06-01T10:01:00.000Z",
      status: "sent",
    });
    await store.recordCommandUsage({
      commandName: "runs",
      discordGuildId: null,
      discordUserId: "discord-user-id",
      durationMs: 32,
      occurredAt: "2026-06-01T10:01:30.000Z",
      status: "succeeded",
    });
    await store.recordGuildMessage({
      channelId: "channel-id",
      discordGuildId: "guild-id",
      messageId: "guild-message-id",
      messageType: "bot_log",
      occurredAt: "2026-06-01T10:01:45.000Z",
      status: "sent",
    });
    await store.recordAutomationRun({
      automationType: "role_assignment",
      discordGuildId: "guild-id",
      eventType: "runs.starting_soon",
      failureCount: 1,
      occurredAt: "2026-06-01T10:02:00.000Z",
      result: { failedUserCount: 1 },
      runId: 123,
      status: "partial",
      successCount: 2,
    });

    await expect(
      store.getSummary(new Date("2026-06-01T10:30:00.000Z")),
    ).resolves.toMatchObject({
      automationRuns: {
        last1h: {
          byStatus: {
            partial: 1,
          },
          total: 1,
        },
      },
      commandUsages: {
        last1h: {
          byStatus: {
            succeeded: 1,
          },
          total: 1,
        },
      },
      dmDeliveries: {
        last1h: {
          byStatus: {
            sent: 1,
          },
          total: 1,
        },
      },
      events: {
        last1h: {
          byStatus: {
            accepted: 1,
          },
          total: 1,
        },
      },
      guildMessages: {
        last1h: {
          byStatus: {
            sent: 1,
          },
          total: 1,
        },
      },
    });
    await expect(store.getEvents(1)).resolves.toMatchObject([
      {
        dataType: "assignments.assigned",
        discordUserId: "discord-user-id",
        eventType: "discord.notification.delivery",
        requestHost: "127.0.0.1",
        requestId: "event-id",
        status: "accepted",
      },
    ]);
    await expect(store.getDmDeliveries()).resolves.toMatchObject([
      {
        discordUserId: "discord-user-id",
        eventType: "discord.notification.delivery",
        messageId: "message-id",
        notificationType: "assignments.assigned",
        status: "sent",
      },
    ]);
    await expect(store.getAutomationRuns()).resolves.toMatchObject([
      {
        automationType: "role_assignment",
        discordGuildId: "guild-id",
        eventType: "runs.starting_soon",
        failureCount: 1,
        result: {
          failedUserCount: 1,
        },
        runId: 123,
        status: "partial",
        successCount: 2,
      },
    ]);
    await expect(store.getCommandUsages()).resolves.toMatchObject([
      {
        commandName: "runs",
        discordUserId: "discord-user-id",
        durationMs: 32,
        status: "succeeded",
      },
    ]);
    await expect(store.getGuildMessages()).resolves.toMatchObject([
      {
        channelId: "channel-id",
        discordGuildId: "guild-id",
        messageId: "guild-message-id",
        messageType: "bot_log",
        status: "sent",
      },
    ]);
    await expect(
      store.getDashboardMetrics(new Date("2026-06-01T10:30:00.000Z")),
    ).resolves.toMatchObject({
      breakdowns: {
        commandNames24h: [{ label: "runs", value: 1 }],
        notificationTypes24h: [{ label: "assignments.assigned", value: 1 }],
      },
      totals: {
        automationFailures24h: 1,
        automationRuns24h: 1,
        commandsUsed24h: 1,
        dmsSent24h: 1,
        events24h: 1,
        guildMessagesSent24h: 1,
      },
    });
    const metrics = await store.getDashboardMetrics(new Date("2026-06-01T10:30:00.000Z"));
    const may31 = metrics.trends.daily7d.find((bucket) => bucket.label === "2026-05-31");
    const june1 = metrics.trends.daily7d.find((bucket) => bucket.label === "2026-06-01");

    expect(may31).toMatchObject({
      events: 1,
    });
    expect(june1).toMatchObject({
      events: 1,
    });
  });

  it("records guild runtime rows for the guild dashboard", async () => {
    const store = await createStore();

    await store.recordGuildRuntime({
      botPermissions: "8",
      discordGuildId: "guild-id",
      lastSeenAt: "2026-06-01T10:00:00.000Z",
      memberCount: 42,
      name: "Raid Guild",
      unavailable: false,
    });

    await expect(store.getGuilds()).resolves.toMatchObject([
      {
        botPermissions: "8",
        discordGuildId: "guild-id",
        linked: false,
        memberCount: 42,
        name: "Raid Guild",
        unavailable: false,
      },
    ]);
  });

  it("builds per-guild dashboard records from guild-scoped telemetry", async () => {
    const store = await createStore();

    await store.recordGuildRuntime({
      botPermissions: "8",
      discordGuildId: "guild-id",
      lastSeenAt: "2026-06-01T10:00:00.000Z",
      memberCount: 42,
      name: "Raid Guild",
      unavailable: false,
    });
    await store.recordBotEvent({
      discordGuildId: "guild-id",
      eventType: "discord.guild.run_reminder",
      occurredAt: "2026-06-01T10:01:00.000Z",
      status: "failed",
    });
    await store.recordCommandUsage({
      commandName: "clearrole",
      discordGuildId: "guild-id",
      occurredAt: "2026-06-01T10:02:00.000Z",
      status: "failed",
    });
    await store.recordGuildMessage({
      discordGuildId: "guild-id",
      messageType: "bot_log",
      occurredAt: "2026-06-01T10:03:00.000Z",
      status: "sent",
    });
    await store.recordGuildMessage({
      discordGuildId: "guild-id",
      errorCode: "missing_access",
      messageType: "bot_log",
      occurredAt: "2026-06-01T10:04:00.000Z",
      status: "failed",
    });
    await store.recordAutomationRun({
      automationType: "role_assignment",
      discordGuildId: "guild-id",
      failureCount: 1,
      occurredAt: "2026-06-01T10:05:00.000Z",
      runId: 123,
      status: "partial",
      successCount: 2,
    });

    await expect(
      store.getGuildDashboards(new Date("2026-06-01T10:30:00.000Z")),
    ).resolves.toMatchObject([
      {
        guild: {
          discordGuildId: "guild-id",
          name: "Raid Guild",
        },
        health: {
          issues: expect.arrayContaining([
            expect.objectContaining({
              key: "guild_not_linked",
            }) as unknown,
            expect.objectContaining({
              key: "automation_failures_24h",
            }) as unknown,
            expect.objectContaining({
              key: "guild_message_failures_24h",
            }) as unknown,
          ]) as unknown[],
          status: "degraded",
        },
        recent: {
          automationRuns: [
            expect.objectContaining({
              automationType: "role_assignment",
              status: "partial",
            }) as unknown,
          ],
          commandUsages: [
            expect.objectContaining({
              commandName: "clearrole",
              status: "failed",
            }) as unknown,
          ],
          guildMessages: [
            expect.objectContaining({
              errorCode: "missing_access",
              status: "failed",
            }) as unknown,
            expect.objectContaining({
              status: "sent",
            }) as unknown,
          ],
        },
        totals: {
          automationFailures24h: 1,
          automationRuns24h: 1,
          commandFailures24h: 1,
          commands24h: 1,
          eventFailures24h: 1,
          events24h: 1,
          guildMessageFailures24h: 1,
          guildMessagesSent24h: 1,
        },
      },
    ]);
  });

  async function createStore(): Promise<SqliteAdminStore> {
    const directory = await mkdtemp(join(tmpdir(), "fullparty-admin-"));
    const databasePath = join(directory, "admin.sqlite");
    const store = new SqliteAdminStore(databasePath);

    tempDirs.push(directory);
    stores.push(store);

    return store;
  }
});
