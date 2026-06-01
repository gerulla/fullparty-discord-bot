import { once } from "node:events";
import { createHmac } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { AdminStore } from "../src/admin/adminStore.js";
import type { BotContext } from "../src/bot/context.js";
import {
  createWebhookServer,
  stopWebhookServer,
  type WebhookServerOptions,
} from "../src/http/server.js";
import type { GuildRunRoleMapping } from "../src/guildAutomation/runRoleStore.js";
import { createRuntimeLogBuffer } from "../src/lib/runtimeLogBuffer.js";
import { LatestPayloadStore } from "../src/payloads/latestPayloadStore.js";

describe("Fullparty webhook server", () => {
  const servers: Server[] = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => stopWebhookServer(server)));
    await Promise.all(
      tempDirs.splice(0).map((directory) =>
        rm(directory, {
          force: true,
          recursive: true,
        }),
      ),
    );
  });

  it("reports health without authentication", async () => {
    const baseUrl = await listen(createTestServer());

    await expect(fetchJson(`${baseUrl}/health`)).resolves.toMatchObject({
      body: {
        checks: {
          discord: {
            ok: true,
            ping_ms: 42,
            ready: true,
            status: "healthy",
          },
        },
        ok: true,
        status: "healthy",
      },
      status: 200,
    });
  });

  it("reports degraded health when recent failures exist", async () => {
    const context: BotContext = {
      ...createContext(),
      failureReporter: {
        getHealthSummary: () =>
          Promise.resolve({
            errorCount: 0,
            ignoredCount: 0,
            last24h: {
              count: 3,
              errorCount: 0,
              ignoredCount: 0,
              topSources: {
                guild_automation: 3,
              },
              warnCount: 3,
            },
            lastFailureAt: "2026-05-30T14:00:00.000Z",
            ok: false,
            status: "degraded",
            unhealthyErrorThreshold: 5,
            warnCount: 3,
            windowSeconds: 600,
          }),
        record: () =>
          Promise.resolve({
            action: "test",
            id: 1,
            message: "test",
            occurredAt: "2026-05-30T14:00:00.000Z",
            severity: "warn",
            source: "guild_automation",
          }),
      },
      guildRunReminderQueue: {
        enqueue: () => {
          throw new Error("Not used.");
        },
        getHealthSummary: () =>
          Promise.resolve({
            failedLastWindow: 0,
            ok: true,
            oldestQueuedSeconds: null,
            processing: 0,
            queued: 0,
            status: "healthy",
            stuckProcessing: 0,
            windowSeconds: 600,
          }),
      },
    };
    const baseUrl = await listen(createTestServer({ context }));

    await expect(fetchJson(`${baseUrl}/health`)).resolves.toMatchObject({
      body: {
        checks: {
          guild_automation_queue: {
            ok: true,
            status: "healthy",
          },
          recent_failures: {
            last24h: {
              count: 3,
              topSources: {
                guild_automation: 3,
              },
            },
            status: "degraded",
            warnCount: 3,
          },
        },
        ok: true,
        status: "degraded",
      },
      status: 200,
    });
  });

  it("returns disabled admin API responses when no admin token is configured", async () => {
    const baseUrl = await listen(createTestServer());

    await expect(fetchJson(`${baseUrl}/admin/api/summary`)).resolves.toMatchObject({
      body: {
        error: "admin_api_disabled",
      },
      status: 503,
    });
  });

  it("requires the admin API token before serving telemetry", async () => {
    const context: BotContext = {
      ...createContext(),
      adminStore: createAdminStore(),
    };
    const baseUrl = await listen(
      createTestServer({
        adminApiToken: "admin-token",
        client: {
          channels: { fetch: () => Promise.resolve(null) },
          guilds: {
            cache: new Map(),
          },
          isReady: () => true,
          user: {
            id: "bot-user-id",
          },
          ws: {
            ping: 42,
          },
        } as never,
        context,
      }),
    );

    await expect(fetchJson(`${baseUrl}/admin/api/summary`)).resolves.toMatchObject({
      body: {
        error: "unauthorized",
      },
      status: 401,
    });
  });

  it("serves admin API telemetry with a valid token", async () => {
    const recordedGuildRuntime: unknown[] = [];
    const context: BotContext = {
      ...createContext(),
      adminStore: createAdminStore({
        recordGuildRuntime: (input) => {
          recordedGuildRuntime.push(input);

          return Promise.resolve();
        },
      }),
    };
    const baseUrl = await listen(
      createTestServer({
        adminApiToken: "admin-token",
        client: {
          channels: { fetch: () => Promise.resolve(null) },
          guilds: {
            cache: new Map([
              [
                "guild-id",
                {
                  available: true,
                  id: "guild-id",
                  memberCount: 15,
                  members: {
                    me: {
                      permissions: {
                        bitfield: 8n,
                      },
                    },
                  },
                  name: "Raid Guild",
                },
              ],
            ]),
          },
          isReady: () => true,
          user: {
            id: "bot-user-id",
          },
          ws: {
            ping: 42,
          },
        } as never,
        context,
      }),
    );

    await expect(
      fetchJson(`${baseUrl}/admin/api/summary`, {
        headers: {
          authorization: "Bearer admin-token",
        },
      }),
    ).resolves.toMatchObject({
      body: {
        health: {
          ok: true,
          status: "healthy",
        },
        queue: {
          guildAutomation: {
            jobsByStatus: {},
            oldestQueuedAt: null,
            recentFailedCount: 0,
          },
          userDms: {
            cooldownUsers: 0,
            queuedMessages: 0,
            queuedUsers: 0,
          },
        },
        telemetry: {
          events: {
            last1h: {
              total: 0,
            },
          },
        },
      },
      status: 200,
    });
    expect(recordedGuildRuntime).toEqual([
      {
        botPermissions: "8",
        discordGuildId: "guild-id",
        linkedAt: null,
        memberCount: 15,
        name: "Raid Guild",
        unavailable: false,
      },
    ]);
  });

  it("serves admin dashboard diagnostics with health reasons and failure details", async () => {
    const loggedErrors: unknown[] = [];
    const context: BotContext = {
      ...createContext(),
      adminStore: createAdminStore({
        getFailures: () =>
          Promise.resolve([
            {
              action: "guild_automation_job_retry",
              affectsHealth: true,
              details: {
                attempts: 2,
                serializedError: {
                  message: "Discord API rejected the role update.",
                },
              },
              discordGuildId: "guild-id",
              discordUserId: null,
              errorCode: "guild_automation_job_retry",
              eventType: "runs.starting_soon",
              id: 1,
              message: "Discord API rejected the role update.",
              occurredAt: "2026-06-01T10:15:00.000Z",
              runId: 123,
              severity: "warn",
              source: "queue",
            },
          ]),
      }),
      failureReporter: {
        getHealthSummary: () =>
          Promise.resolve({
            errorCount: 0,
            ignoredCount: 0,
            last24h: {
              count: 1,
              errorCount: 0,
              ignoredCount: 0,
              topSources: {
                queue: 1,
              },
              warnCount: 1,
            },
            lastFailureAt: "2026-06-01T10:15:00.000Z",
            ok: false,
            status: "degraded",
            unhealthyErrorThreshold: 5,
            warnCount: 1,
            windowSeconds: 600,
          }),
        record: () =>
          Promise.resolve({
            action: "test",
            id: 1,
            message: "test",
            occurredAt: "2026-06-01T10:15:00.000Z",
            severity: "warn",
            source: "queue",
          }),
      },
      logger: {
        debug: () => undefined,
        error: (_message, meta) => {
          loggedErrors.push(meta);
        },
        info: () => undefined,
        warn: () => undefined,
      },
    };
    const baseUrl = await listen(
      createTestServer({
        adminApiToken: "admin-token",
        client: {
          channels: { fetch: () => Promise.resolve(null) },
          guilds: {
            cache: new Map(),
          },
          isReady: () => true,
          user: {
            id: "bot-user-id",
          },
          ws: {
            ping: 42,
          },
        } as never,
        context,
      }),
    );

    const result = await fetchJson(`${baseUrl}/admin/api/metrics`, {
      headers: {
        authorization: "Bearer admin-token",
      },
    });

    expect(loggedErrors).toEqual([]);
    expect(result).toMatchObject({
      body: {
        data: {
          diagnostics: {
            healthIssues: [
              {
                check: "recent_failures",
                occurredAt: "2026-06-01T10:15:00.000Z",
                reason:
                  "1 warning(s) affected health in the last 10m. The unhealthy threshold is 5 recent error(s).",
                severity: "warn",
                status: "degraded",
              },
            ],
            recentFailures: [
              {
                action: "guild_automation_job_retry",
                details: {
                  attempts: 2,
                },
                errorCode: "guild_automation_job_retry",
                message: "Discord API rejected the role update.",
                source: "queue",
              },
            ],
          },
          health: {
            status: "degraded",
          },
        },
      },
      status: 200,
    });
  });

  it("serves recent runtime logs with a valid admin token", async () => {
    const runtimeLogs = createRuntimeLogBuffer({ maxLines: 3 });

    runtimeLogs.append("info", "oldest");
    runtimeLogs.append("warn", "middle");
    runtimeLogs.append("error", "newest");

    const context: BotContext = {
      ...createContext(),
      adminStore: createAdminStore(),
      runtimeLogs,
    };
    const baseUrl = await listen(
      createTestServer({
        adminApiToken: "admin-token",
        client: {
          channels: { fetch: () => Promise.resolve(null) },
          guilds: {
            cache: new Map(),
          },
          isReady: () => true,
          user: {
            id: "bot-user-id",
          },
          ws: {
            ping: 42,
          },
        } as never,
        context,
      }),
    );

    await expect(
      fetchJson(`${baseUrl}/admin/api/logs?limit=2`, {
        headers: {
          authorization: "Bearer admin-token",
        },
      }),
    ).resolves.toMatchObject({
      body: {
        data: [
          {
            level: "error",
            message: "newest",
          },
          {
            level: "warn",
            message: "middle",
          },
        ],
        meta: {
          limit: 2,
          maxLines: 3,
          totalBuffered: 3,
        },
      },
      status: 200,
    });
  });

  it("serves the built admin UI under /admin", async () => {
    const adminUiRoot = await mkdtemp(join(tmpdir(), "fullparty-admin-ui-"));

    tempDirs.push(adminUiRoot);
    await mkdir(join(adminUiRoot, "assets"));
    await writeFile(
      join(adminUiRoot, "index.html"),
      '<div id="app">FullParty Admin</div>',
    );
    await writeFile(join(adminUiRoot, "assets", "app.js"), "console.log('admin');");

    const baseUrl = await listen(createTestServer({ adminUiRoot }));

    await expect(fetchText(`${baseUrl}/admin/`)).resolves.toMatchObject({
      body: '<div id="app">FullParty Admin</div>',
      contentType: "text/html; charset=utf-8",
      status: 200,
    });
    await expect(fetchText(`${baseUrl}/admin/assets/app.js`)).resolves.toMatchObject({
      body: "console.log('admin');",
      contentType: "text/javascript; charset=utf-8",
      status: 200,
    });
  });

  it("accepts signed Fullparty integration healthchecks", async () => {
    const baseUrl = await listen(createTestServer());
    const timestamp = currentTimestamp();

    await expect(
      fetchJson(`${baseUrl}/events`, {
        headers: {
          "x-fullparty-event": "integration.healthcheck",
          "x-fullparty-signature": signBody(timestamp, ""),
          "x-fullparty-timestamp": timestamp,
        },
        method: "GET",
      }),
    ).resolves.toMatchObject({
      body: {
        event: "integration.healthcheck",
        ok: true,
        status: "healthy",
      },
      status: 200,
    });
  });

  it("requires Fullparty signature headers for events", async () => {
    const baseUrl = await listen(createTestServer());

    await expect(
      fetchJson(`${baseUrl}/events`, {
        body: JSON.stringify({ event: "ping" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    ).resolves.toMatchObject({
      body: {
        error: "missing_signature",
      },
      status: 401,
    });
  });

  it("rejects invalid signatures", async () => {
    const baseUrl = await listen(createTestServer());
    const body = JSON.stringify({ event: "ping" });

    await expect(
      fetchJson(`${baseUrl}/events`, {
        body,
        headers: {
          "content-type": "application/json",
          "x-fullparty-signature": "sha256=invalid",
          "x-fullparty-timestamp": currentTimestamp(),
        },
        method: "POST",
      }),
    ).resolves.toMatchObject({
      body: {
        error: "invalid_signature",
      },
      status: 401,
    });
  });

  it("rejects stale signatures", async () => {
    const body = JSON.stringify({ event: "ping" });
    const timestamp = "1";
    const baseUrl = await listen(createTestServer());

    await expect(
      fetchJson(`${baseUrl}/events`, {
        body,
        headers: {
          "content-type": "application/json",
          "x-fullparty-signature": signBody(timestamp, body),
          "x-fullparty-timestamp": timestamp,
        },
        method: "POST",
      }),
    ).resolves.toMatchObject({
      body: {
        error: "stale_signature",
      },
      status: 401,
    });
  });

  it("sends a welcome DM when a user app install event arrives", async () => {
    const sentMessages: unknown[] = [];
    const baseUrl = await listen(
      createTestServer({
        client: {
          channels: {
            fetch: () => Promise.resolve(null),
          },
          users: {
            fetch: () =>
              Promise.resolve({
                send: (message: unknown) => {
                  sentMessages.push(message);
                  return Promise.resolve({ id: "dm-message-id" });
                },
              }),
          },
        } as never,
      }),
    );
    const payload = {
      data: {
        discord_user: {
          id: "discord-user-id",
        },
        welcome_message: "Welcome aboard.",
      },
      event: "discord.user_app.installed",
    };

    await expect(postAction(baseUrl, payload)).resolves.toMatchObject({
      body: {
        event: "discord.user_app.installed",
        result: {
          discordUserId: "discord-user-id",
          messageId: "dm-message-id",
        },
      },
      status: 200,
    });
    expect(sentMessages).toEqual([{ content: "Welcome aboard." }]);
  });

  it("sends the default welcome DM when no custom message is provided", async () => {
    const sentMessages: unknown[] = [];
    const baseUrl = await listen(
      createTestServer({
        client: {
          channels: {
            fetch: () => Promise.resolve(null),
          },
          users: {
            fetch: () =>
              Promise.resolve({
                send: (message: unknown) => {
                  sentMessages.push(message);
                  return Promise.resolve({ id: "default-dm-message-id" });
                },
              }),
          },
        } as never,
      }),
    );
    const payload = {
      data: {
        discord_user: {
          id: "discord-user-id",
        },
      },
      event: "discord.user_app.installed",
    };

    await expect(postAction(baseUrl, payload)).resolves.toMatchObject({
      body: {
        result: {
          messageId: "default-dm-message-id",
        },
      },
      status: 200,
    });
    expect(sentMessages).toEqual([
      {
        content:
          "Hey, welcome to FullParty. Your Discord account is connected and ready to go.\n\nYou can use `/runs` to check your upcoming runs and `/applications` to review your FullParty applications right here in DMs.\n\nI'll also send your FullParty notifications in this DM, so run updates, applications, reminders, and account changes stay easy to find.\n\nYou can disconnect this anytime from your FullParty account settings.",
      },
    ]);
  });

  it("returns queued DM results when the per-user DM limiter delays delivery", async () => {
    const queuedOperations: unknown[] = [];
    const context: BotContext = {
      ...createContext(),
      userDmRateLimiter: {
        send: (
          discordUserId: string,
          operation: () => Promise<Record<string, unknown>>,
        ) => {
          queuedOperations.push(operation);

          return Promise.resolve({
            discordUserId,
            nextAttemptAt: "2026-06-01T00:05:00.000Z",
            queuePosition: 1,
            queued: true,
            rateLimited: true,
          });
        },
        stop: () => undefined,
      } as never,
    };
    const baseUrl = await listen(
      createTestServer({
        client: {
          channels: {
            fetch: () => Promise.resolve(null),
          },
          users: {
            fetch: () => {
              throw new Error("Delayed DM should not be sent during webhook handling.");
            },
          },
        } as never,
        context,
      }),
    );

    await expect(
      postAction(baseUrl, {
        data: {
          discord_user: {
            id: "discord-user-id",
          },
        },
        event: "discord.user_app.installed",
      }),
    ).resolves.toMatchObject({
      body: {
        result: {
          discordUserId: "discord-user-id",
          nextAttemptAt: "2026-06-01T00:05:00.000Z",
          queuePosition: 1,
          queued: true,
          rateLimited: true,
        },
      },
      status: 200,
    });
    expect(queuedOperations).toHaveLength(1);
  });

  it("sends a disconnect DM when a user app disconnect event arrives", async () => {
    const sentMessages: unknown[] = [];
    const baseUrl = await listen(
      createTestServer({
        client: {
          channels: {
            fetch: () => Promise.resolve(null),
          },
          users: {
            fetch: () =>
              Promise.resolve({
                send: (message: unknown) => {
                  sentMessages.push(message);
                  return Promise.resolve({ id: "disconnect-dm-message-id" });
                },
              }),
          },
        } as never,
      }),
    );
    const payload = {
      data: {
        discord_user: {
          id: "discord-user-id",
        },
      },
      event: "discord.user_app.disconnected",
    };

    await expect(postAction(baseUrl, payload)).resolves.toMatchObject({
      body: {
        event: "discord.user_app.disconnected",
        result: {
          discordUserId: "discord-user-id",
          messageId: "disconnect-dm-message-id",
        },
      },
      status: 200,
    });
    expect(sentMessages).toEqual([
      {
        content:
          "FullParty has disconnected Discord for your account.\nTo fully remove the app from Discord, open Discord Settings > Authorized Apps and remove FullParty.",
      },
    ]);
  });

  it("sends notification delivery DMs from wrapped and direct payloads", async () => {
    const sentMessages: unknown[] = [];
    const baseUrl = await listen(
      createTestServer({
        client: {
          channels: {
            fetch: () => Promise.resolve(null),
          },
          users: {
            fetch: () =>
              Promise.resolve({
                send: (message: unknown) => {
                  sentMessages.push(message);
                  return Promise.resolve({ id: "notification-dm-message-id" });
                },
              }),
          },
        } as never,
      }),
    );
    const notificationDelivery = {
      category: "assignments",
      discord_user: {
        id: "123456789012345678",
      },
      notification: {
        action_url: "/groups/example/activities/99",
        category: "assignments",
        params: {},
        payload: null,
        type: "assignments.assigned",
      },
      notification_delivery_id: 123,
      notification_event_id: 456,
      type: "assignments.assigned",
      user: {
        id: 42,
        name: "Giki",
      },
    };
    const expectedMessage = {
      components: [
        {
          components: [
            {
              emoji: {
                name: "🔗",
              },
              label: "View assignment",
              style: 5,
              type: 2,
              url: "https://fullparty.gg/groups/example/activities/99",
            },
          ],
          type: 1,
        },
      ],
      embeds: [
        {
          color: 0x22c55e,
          description: "You were assigned to a roster slot.",
          footer: {
            text: "🎯 FullParty • Assignments",
          },
          title: "✅ Roster assignment updated",
          url: "https://fullparty.gg/groups/example/activities/99",
        },
      ],
    };

    const wrappedPayload = {
      data: notificationDelivery,
      event: "discord.notification.delivery",
      id: "3f0bb59e-8c34-4f6a-a5d4-8fd0fd9c9d7f",
      integration_client_id: 1,
      occurred_at: "2026-05-29T14:22:10+00:00",
    };

    await expect(postAction(baseUrl, wrappedPayload)).resolves.toMatchObject({
      body: {
        event: "discord.notification.delivery",
        requestId: "3f0bb59e-8c34-4f6a-a5d4-8fd0fd9c9d7f",
        result: {
          category: "assignments",
          discordUserId: "123456789012345678",
          messageId: "notification-dm-message-id",
          notificationDeliveryId: 123,
          notificationEventId: 456,
          type: "assignments.assigned",
        },
      },
      status: 200,
    });

    await expect(postAction(baseUrl, notificationDelivery)).resolves.toMatchObject({
      body: {
        event: "discord.notification.delivery",
        result: {
          category: "assignments",
          discordUserId: "123456789012345678",
          messageId: "notification-dm-message-id",
          notificationDeliveryId: 123,
          notificationEventId: 456,
          type: "assignments.assigned",
        },
      },
      status: 200,
    });
    expect(sentMessages).toEqual([expectedMessage, expectedMessage]);
  });

  it("queues guild run reminders when a queue is configured", async () => {
    const queuedPayloads: unknown[] = [];
    const context: BotContext = {
      ...createContext(),
      guildRunReminderQueue: {
        enqueue: (job) => {
          queuedPayloads.push(job);

          return Promise.resolve({
            alreadyQueued: false,
            discordGuildId: job.data.discord_guild_id,
            jobId: 99,
            jobKind: job.kind,
            queueStatus: "queued",
            queued: true,
            ...(job.kind === "run_reminder"
              ? { reminderType: job.data.reminder_type }
              : {}),
            runId: job.data.run_id,
            type: job.data.type,
          });
        },
      },
    };
    const baseUrl = await listen(
      createTestServer({
        client: {
          channels: {
            fetch: () => Promise.resolve(null),
          },
          guilds: {
            fetch: () => {
              throw new Error("Guild should not be fetched during enqueue.");
            },
          },
        } as never,
        context,
      }),
    );

    await expect(
      postAction(baseUrl, {
        data: {
          discord_guild_id: "900100200300400500",
          discord_user_ids: ["123"],
          participants: [],
          reminder_type: "starting_soon",
          run_id: 123,
          type: "runs.starting_soon",
        },
        event: "discord.guild.run_reminder",
      }),
    ).resolves.toMatchObject({
      body: {
        event: "discord.guild.run_reminder",
        result: {
          discordGuildId: "900100200300400500",
          jobId: 99,
          jobKind: "run_reminder",
          queueStatus: "queued",
          queued: true,
          runId: 123,
          type: "runs.starting_soon",
        },
      },
      status: 200,
    });
    expect(queuedPayloads).toEqual([
      {
        data: {
          discord_guild_id: "900100200300400500",
          discord_user_ids: ["123"],
          participants: [],
          reminder_type: "starting_soon",
          run_id: 123,
          type: "runs.starting_soon",
        },
        kind: "run_reminder",
      },
    ]);
  });

  it("assigns the upcoming raider role for guild run reminders", async () => {
    const nicknameUpdates: {
      discordUserId: string;
      nickname: string;
      reason: string;
    }[] = [];
    const roleAdds: { discordUserId: string; reason: string; roleId: string }[] = [];
    const channelOverwriteEdits: unknown[] = [];
    const createdRoles: unknown[] = [];
    const logMessages: unknown[] = [];
    const runRoleStore = createMemoryRunRoleStore();
    const context: BotContext = {
      ...createContext(),
      guildRunRoles: runRoleStore,
      guildSettings: {
        get: (guildId) =>
          Promise.resolve({
            botLogChannelId: "bot-log-channel-id",
            guildId,
            syncDiscordNamesToFf14: true,
            upcomingRaiderRoleId: "upcoming-raider-role-id",
          }),
        update: (guildId) => Promise.resolve({ guildId, syncDiscordNamesToFf14: false }),
      },
    };
    const baseUrl = await listen(
      createTestServer({
        client: {
          channels: {
            fetch: () =>
              Promise.resolve({
                send: (message: unknown) => {
                  logMessages.push(message);
                  return Promise.resolve({ id: "bot-log-message-id" });
                },
              }),
          },
          guilds: {
            fetch: () =>
              Promise.resolve({
                members: {
                  fetch: (discordUserId: string) =>
                    Promise.resolve({
                      displayName:
                        discordUserId === "456"
                          ? "Already Synced [Lich]"
                          : "Old Nickname",
                      nickname:
                        discordUserId === "456"
                          ? "Already Synced [Lich]"
                          : "Old Nickname",
                      permissions: {
                        has: () => true,
                      },
                      roles: {
                        add: (roleId: string, reason: string) => {
                          roleAdds.push({ discordUserId, reason, roleId });
                          return Promise.resolve({});
                        },
                        highest: {
                          comparePositionTo: () => 1,
                          id: "bot-role-id",
                          name: "Bot Role",
                        },
                      },
                      setNickname: (nickname: string, reason: string) => {
                        nicknameUpdates.push({ discordUserId, nickname, reason });
                        return Promise.resolve({});
                      },
                    }),
                  me: {
                    permissions: {
                      has: () => true,
                    },
                    roles: {
                      highest: {
                        comparePositionTo: () => 1,
                        id: "bot-role-id",
                        name: "Bot Role",
                      },
                    },
                  },
                },
                channels: {
                  fetch: () =>
                    Promise.resolve(
                      new Map([
                        [
                          "channel-id",
                          {
                            id: "channel-id",
                            name: "run-chat",
                            permissionOverwrites: {
                              cache: {
                                get: (roleId: string) =>
                                  roleId === "upcoming-raider-role-id"
                                    ? {
                                        allow: { bitfield: 1024n },
                                        deny: { bitfield: 0n },
                                        id: roleId,
                                      }
                                    : undefined,
                              },
                              edit: (
                                roleId: string,
                                options: unknown,
                                reason: string,
                              ) => {
                                channelOverwriteEdits.push({ options, reason, roleId });
                                return Promise.resolve({});
                              },
                            },
                          },
                        ],
                      ]),
                    ),
                },
                roles: {
                  cache: {
                    get: (roleId: string) =>
                      roleId === "upcoming-raider-role-id"
                        ? {
                            color: 0x22c55e,
                            hoist: false,
                            id: roleId,
                            mentionable: false,
                            name: "Upcoming Raider Template",
                            permissions: { bitfield: 0n },
                          }
                        : undefined,
                  },
                  create: (options: { name: string }) => {
                    const role = {
                      id: "run-role-id",
                      name: options.name,
                      permissions: { bitfield: 0n },
                    };
                    createdRoles.push(role);
                    return Promise.resolve(role);
                  },
                  fetch: (roleId: string) =>
                    Promise.resolve(
                      roleId === "upcoming-raider-role-id"
                        ? {
                            color: 0x22c55e,
                            hoist: false,
                            id: roleId,
                            mentionable: false,
                            name: "Upcoming Raider Template",
                            permissions: { bitfield: 0n },
                          }
                        : undefined,
                    ),
                },
              }),
          },
        } as never,
        context,
      }),
    );

    await expect(
      postAction(baseUrl, {
        data: {
          activity_id: 123,
          activity_title: "Cloud of Darkness",
          discord_guild_id: "900100200300400500",
          discord_user_ids: ["123", "456"],
          group_id: 45,
          group_slug: "my-group",
          participants: [
            {
              discord_user_id: "123",
              primary_character: {
                name: "Character Name",
                world: "Twintania",
              },
              user_id: 1,
            },
            {
              discord_user_id: "456",
              primary_character: {
                name: "Already Synced",
                world: "Lich",
              },
              user_id: 2,
            },
          ],
          reminder_type: "starting_soon",
          run_id: 123,
          starts_at: "2026-05-30T21:00:00+00:00",
          type: "runs.starting_soon",
        },
        event: "discord.guild.run_reminder",
      }),
    ).resolves.toMatchObject({
      body: {
        event: "discord.guild.run_reminder",
        result: {
          assignedUserCount: 2,
          discordGuildId: "900100200300400500",
          failedUserCount: 0,
          nicknameFailedUserCount: 0,
          nicknameRequestedUserCount: 2,
          nicknameSkippedUserCount: 1,
          nicknameSyncedUserCount: 1,
          nicknameSyncEnabled: true,
          requestedUserCount: 2,
          roleId: "run-role-id",
          roleName: "FullParty: Cloud of Darkness 21:00 UTC",
          runId: 123,
          templateRoleId: "upcoming-raider-role-id",
          type: "runs.starting_soon",
        },
      },
      status: 200,
    });
    expect(roleAdds).toEqual([
      {
        discordUserId: "123",
        reason: "FullParty starting_soon run role for run 123",
        roleId: "run-role-id",
      },
      {
        discordUserId: "456",
        reason: "FullParty starting_soon run role for run 123",
        roleId: "run-role-id",
      },
    ]);
    expect(createdRoles).toEqual([
      {
        id: "run-role-id",
        name: "FullParty: Cloud of Darkness 21:00 UTC",
        permissions: { bitfield: 0n },
      },
    ]);
    expect(channelOverwriteEdits).toEqual([
      {
        options: {
          allow: "1024",
          deny: "0",
        },
        reason: "FullParty copied template role overwrites for run 123.",
        roleId: "run-role-id",
      },
    ]);
    expect(nicknameUpdates).toEqual([
      {
        discordUserId: "123",
        nickname: "Character Name [Twintania]",
        reason: "FullParty starting_soon nickname sync for run 123",
      },
    ]);
    expect(logMessages).toHaveLength(2);
    expect(JSON.stringify(logMessages)).not.toContain("Processing Time");
    expect(JSON.stringify(logMessages)).not.toContain("Performance");
    expect(logMessages[0]).toMatchObject({
      allowedMentions: {
        parse: [],
      },
      embeds: [
        {
          color: 0x22c55e,
          description: expect.stringContaining(
            "**Run #123** • 🕒 **Upcoming**",
          ) as string,
          fields: expect.arrayContaining([
            {
              inline: true,
              name: "✅ Successful Assignments",
              value: "2 users\nassigned",
            },
            {
              inline: true,
              name: "❌ Failed Assignments",
              value: "0 users\nfailed",
            },
            {
              inline: true,
              name: "📈 Success Rate",
              value: "100.0%\nassignment rate",
            },
            {
              inline: true,
              name: "🛡️ Run Role",
              value: "<@&run-role-id>\n`FullParty: Cloud of Darkness 21:00 UTC`",
            },
            {
              inline: true,
              name: "📋 Template",
              value: "<@&upcoming-raider-role-id>",
            },
            {
              inline: true,
              name: "🔐 Channel Access",
              value: "1 overwrite\ncopied",
            },
          ]) as unknown[],
          footer: {
            text: "FullParty • Guild Automation",
          },
          title: "🛡️ Role Assignment - Complete",
        },
      ],
    });
    expect(logMessages[1]).toMatchObject({
      allowedMentions: {
        parse: [],
      },
      embeds: [
        {
          color: 0x22c55e,
          description: expect.stringContaining(
            "**Run #123** • 🕒 **Upcoming**",
          ) as string,
          fields: expect.arrayContaining([
            {
              inline: true,
              name: "✅ Successful Updates",
              value: "1 user\nupdated",
            },
            {
              inline: true,
              name: "☑️ Already Correct",
              value: "1 user\nunchanged",
            },
            {
              inline: true,
              name: "❌ Failed Updates",
              value: "0 users\nfailed",
            },
            {
              inline: true,
              name: "📈 Success Rate",
              value: "100.0%\nhandled",
            },
            {
              inline: true,
              name: "🔄 Update Mode",
              value: "Primary character\nName Surname [World]",
            },
          ]) as unknown[],
          footer: {
            text: "FullParty • Guild Automation",
          },
          title: "🏷️ Nickname Synchronization - Complete",
        },
      ],
    });
  });

  it("skips guild run reminder role assignment when no role is configured", async () => {
    const logMessages: unknown[] = [];
    const context: BotContext = {
      ...createContext(),
      guildSettings: {
        get: (guildId) =>
          Promise.resolve({
            botLogChannelId: "bot-log-channel-id",
            guildId,
            syncDiscordNamesToFf14: false,
          }),
        update: (guildId) => Promise.resolve({ guildId, syncDiscordNamesToFf14: false }),
      },
    };
    const baseUrl = await listen(
      createTestServer({
        client: {
          channels: {
            fetch: () =>
              Promise.resolve({
                send: (message: unknown) => {
                  logMessages.push(message);
                  return Promise.resolve({ id: "bot-log-message-id" });
                },
              }),
          },
          guilds: {
            fetch: () => {
              throw new Error("Guild should not be fetched without a configured role.");
            },
          },
        } as never,
        context,
      }),
    );

    await expect(
      postAction(baseUrl, {
        data: {
          discord_guild_id: "900100200300400500",
          discord_user_ids: ["123"],
          participants: [],
          reminder_type: "starting_now",
          run_id: 123,
          type: "runs.starting_now",
        },
        event: "discord.guild.run_reminder",
      }),
    ).resolves.toMatchObject({
      body: {
        event: "discord.guild.run_reminder",
        result: {
          assignedUserCount: 0,
          failedUserCount: 0,
          requestedUserCount: 1,
          skippedReason: "upcoming_raider_role_not_configured",
          type: "runs.starting_now",
        },
      },
      status: 200,
    });
    expect(logMessages).toHaveLength(1);
    expect(JSON.stringify(logMessages)).not.toContain("Processing Time");
    expect(JSON.stringify(logMessages)).not.toContain("Performance");
    expect(logMessages[0]).toMatchObject({
      allowedMentions: {
        parse: [],
      },
      embeds: [
        {
          color: 0x64748b,
          description: expect.stringContaining(
            "**Run #123** • 🚨 **Starting Now**",
          ) as string,
          fields: expect.arrayContaining([
            {
              inline: true,
              name: "🛡️ Run Role",
              value: "_Not created_",
            },
            {
              inline: false,
              name: "ℹ️ Note",
              value: "Run role template is not configured in `/setup`.",
            },
          ]) as unknown[],
          title: "🛡️ Role Assignment - Skipped",
        },
      ],
    });
  });

  it("deletes the temporary run role when a guild run completes", async () => {
    const deletedRoles: string[] = [];
    const logMessages: unknown[] = [];
    const runRoleStore = createMemoryRunRoleStore();
    const now = new Date().toISOString();

    await runRoleStore.upsert({
      createdAt: now,
      discordGuildId: "900100200300400500",
      roleId: "run-role-id",
      roleName: "FullParty: Cloud of Darkness 21:00 UTC",
      runId: 123,
      status: "active",
      templateRoleId: "upcoming-raider-role-id",
      updatedAt: now,
    });

    const context: BotContext = {
      ...createContext(),
      guildRunRoles: runRoleStore,
      guildSettings: {
        get: (guildId) =>
          Promise.resolve({
            botLogChannelId: "bot-log-channel-id",
            guildId,
            syncDiscordNamesToFf14: false,
            upcomingRaiderRoleId: "upcoming-raider-role-id",
          }),
        update: (guildId) => Promise.resolve({ guildId, syncDiscordNamesToFf14: false }),
      },
    };
    const baseUrl = await listen(
      createTestServer({
        client: {
          channels: {
            fetch: () =>
              Promise.resolve({
                send: (message: unknown) => {
                  logMessages.push(message);
                  return Promise.resolve({ id: "bot-log-message-id" });
                },
              }),
          },
          guilds: {
            fetch: () =>
              Promise.resolve({
                members: {
                  fetch: () =>
                    Promise.reject(new Error("Members should not be fetched.")),
                },
                roles: {
                  cache: {
                    get: (roleId: string) =>
                      roleId === "run-role-id"
                        ? {
                            delete: () => {
                              deletedRoles.push(roleId);
                              return Promise.resolve({});
                            },
                            id: roleId,
                            name: "FullParty: Cloud of Darkness 21:00 UTC",
                          }
                        : undefined,
                  },
                  fetch: (roleId: string) =>
                    Promise.resolve(
                      roleId === "run-role-id"
                        ? {
                            delete: () => {
                              deletedRoles.push(roleId);
                              return Promise.resolve({});
                            },
                            id: roleId,
                            name: "FullParty: Cloud of Darkness 21:00 UTC",
                          }
                        : undefined,
                    ),
                },
              }),
          },
        } as never,
        context,
      }),
    );

    await expect(
      postAction(baseUrl, {
        data: {
          discord_guild_id: "900100200300400500",
          group_slug: "my-group",
          participants: [
            {
              discord_user_id: "999",
              primary_character: {
                name: "Giki Chomusuke",
                world: "Ragnarok",
              },
              should_keep_group_role: true,
              user_id: 5,
            },
          ],
          run_id: 123,
          type: "runs.completed",
        },
        event: "discord.guild.run_completed",
      }),
    ).resolves.toMatchObject({
      body: {
        event: "discord.guild.run_completed",
        result: {
          deletedRoleCount: 1,
          failedRoleCount: 0,
          roleId: "run-role-id",
          roleName: "FullParty: Cloud of Darkness 21:00 UTC",
          runId: 123,
          type: "runs.completed",
        },
      },
      status: 200,
    });
    expect(deletedRoles).toEqual(["run-role-id"]);
    await expect(runRoleStore.get("900100200300400500", 123)).resolves.toMatchObject({
      status: "deleted",
    });
    expect(logMessages).toHaveLength(1);
    expect(logMessages[0]).toMatchObject({
      embeds: [
        {
          color: 0x22c55e,
          description: expect.stringContaining(
            "**Run #123** • ✅ **Completed**",
          ) as string,
          fields: expect.arrayContaining([
            {
              inline: true,
              name: "🧹 Deleted Roles",
              value: "1 role\ndeleted",
            },
            {
              inline: true,
              name: "🛡️ Run Role",
              value: "<@&run-role-id>\n`FullParty: Cloud of Darkness 21:00 UTC`",
            },
          ]) as unknown[],
          title: "🧹 Run Role Cleanup - Complete",
        },
      ],
    });
  });

  it("deletes the temporary run role when a guild run is cancelled", async () => {
    const deletedRoles: string[] = [];
    const logMessages: unknown[] = [];
    const runRoleStore = createMemoryRunRoleStore();
    const now = new Date().toISOString();

    await runRoleStore.upsert({
      createdAt: now,
      discordGuildId: "900100200300400500",
      roleId: "cancelled-run-role-id",
      roleName: "FullParty: Cancelled Run 21:00 UTC",
      runId: 456,
      status: "active",
      templateRoleId: "upcoming-raider-role-id",
      updatedAt: now,
    });

    const context: BotContext = {
      ...createContext(),
      guildRunRoles: runRoleStore,
      guildSettings: {
        get: (guildId) =>
          Promise.resolve({
            botLogChannelId: "bot-log-channel-id",
            guildId,
            syncDiscordNamesToFf14: false,
            upcomingRaiderRoleId: "upcoming-raider-role-id",
          }),
        update: (guildId) => Promise.resolve({ guildId, syncDiscordNamesToFf14: false }),
      },
    };
    const baseUrl = await listen(
      createTestServer({
        client: {
          channels: {
            fetch: () =>
              Promise.resolve({
                send: (message: unknown) => {
                  logMessages.push(message);
                  return Promise.resolve({ id: "bot-log-message-id" });
                },
              }),
          },
          guilds: {
            fetch: () =>
              Promise.resolve({
                members: {
                  fetch: () =>
                    Promise.reject(new Error("Members should not be fetched.")),
                },
                roles: {
                  cache: {
                    get: (roleId: string) =>
                      roleId === "cancelled-run-role-id"
                        ? {
                            delete: () => {
                              deletedRoles.push(roleId);
                              return Promise.resolve({});
                            },
                            id: roleId,
                            name: "FullParty: Cancelled Run 21:00 UTC",
                          }
                        : undefined,
                  },
                  fetch: (roleId: string) =>
                    Promise.resolve(
                      roleId === "cancelled-run-role-id"
                        ? {
                            delete: () => {
                              deletedRoles.push(roleId);
                              return Promise.resolve({});
                            },
                            id: roleId,
                            name: "FullParty: Cancelled Run 21:00 UTC",
                          }
                        : undefined,
                    ),
                },
              }),
          },
        } as never,
        context,
      }),
    );

    await expect(
      postAction(baseUrl, {
        data: {
          discord_guild_id: "900100200300400500",
          group_slug: "my-group",
          participants: [
            {
              discord_user_id: "999",
              primary_character: {
                name: "Giki Chomusuke",
                world: "Ragnarok",
              },
              should_keep_group_role: true,
              user_id: 5,
            },
          ],
          run_id: 456,
        },
        event: "discord.guild.run_cancelled",
      }),
    ).resolves.toMatchObject({
      body: {
        event: "discord.guild.run_cancelled",
        result: {
          deletedRoleCount: 1,
          failedRoleCount: 0,
          roleId: "cancelled-run-role-id",
          roleName: "FullParty: Cancelled Run 21:00 UTC",
          runId: 456,
          type: "runs.cancelled",
        },
      },
      status: 200,
    });
    expect(deletedRoles).toEqual(["cancelled-run-role-id"]);
    await expect(runRoleStore.get("900100200300400500", 456)).resolves.toMatchObject({
      status: "deleted",
    });
    expect(logMessages).toHaveLength(1);
    expect(logMessages[0]).toMatchObject({
      embeds: [
        {
          color: 0x22c55e,
          description: expect.stringContaining(
            "**Run #456** • 🚫 **Cancelled**",
          ) as string,
          title: "🧹 Run Role Cleanup - Complete",
        },
      ],
    });
  });

  it("tells server owners when the bot cannot manage roles", async () => {
    const logMessages: unknown[] = [];
    const runRoleStore = createMemoryRunRoleStore();
    const context: BotContext = {
      ...createContext(),
      guildRunRoles: runRoleStore,
      guildSettings: {
        get: (guildId) =>
          Promise.resolve({
            botLogChannelId: "bot-log-channel-id",
            guildId,
            syncDiscordNamesToFf14: false,
            upcomingRaiderRoleId: "upcoming-raider-role-id",
          }),
        update: (guildId) => Promise.resolve({ guildId, syncDiscordNamesToFf14: false }),
      },
    };
    const baseUrl = await listen(
      createTestServer({
        client: {
          channels: {
            fetch: () =>
              Promise.resolve({
                send: (message: unknown) => {
                  logMessages.push(message);
                  return Promise.resolve({ id: "bot-log-message-id" });
                },
              }),
          },
          guilds: {
            fetch: () =>
              Promise.resolve({
                members: {
                  fetch: () =>
                    Promise.reject(new Error("Members should not be fetched.")),
                  me: {
                    permissions: {
                      has: () => false,
                    },
                  },
                },
                roles: {
                  cache: {
                    get: (roleId: string) =>
                      roleId === "upcoming-raider-role-id"
                        ? {
                            id: roleId,
                            name: "Upcoming Raider Template",
                            permissions: { bitfield: 0n },
                          }
                        : undefined,
                  },
                },
              }),
          },
        } as never,
        context,
      }),
    );

    await expect(
      postAction(baseUrl, {
        data: {
          discord_guild_id: "900100200300400500",
          discord_user_ids: ["123"],
          participants: [],
          reminder_type: "starting_soon",
          run_id: 123,
          type: "runs.starting_soon",
        },
        event: "discord.guild.run_reminder",
      }),
    ).resolves.toMatchObject({
      body: {
        result: {
          assignedUserCount: 0,
          skippedReason: "bot_missing_manage_roles",
        },
      },
      status: 200,
    });
    expect(logMessages[0]).toMatchObject({
      embeds: [
        {
          color: 0x64748b,
          fields: expect.arrayContaining([
            {
              inline: false,
              name: "ℹ️ Note",
              value:
                "The bot needs the Manage Roles permission to create, delete, and assign run roles.",
            },
          ]) as unknown[],
          title: "🛡️ Role Assignment - Skipped",
        },
      ],
    });
  });

  it("returns a Discord guild snapshot in the event response", async () => {
    const context: BotContext = {
      ...createContext(),
      guildSettings: {
        get: (guildId) =>
          Promise.resolve({
            botLogChannelId: "bot-log-channel-id",
            botModeratorRoleId: "bot-moderator-role-id",
            guildId,
            linkedAt: "2026-06-01T10:00:00.000Z",
            runAnnouncementChannelId: "run-announcement-channel-id",
            syncDiscordNamesToFf14: true,
            upcomingRaiderRoleId: "template-role-id",
          }),
        update: (guildId) => Promise.resolve({ guildId, syncDiscordNamesToFf14: false }),
      },
    };
    const baseUrl = await listen(
      createTestServer({
        client: {
          guilds: {
            fetch: () =>
              Promise.resolve({
                channels: {
                  fetch: () =>
                    Promise.resolve(
                      new Map([
                        [
                          "bot-log-channel-id",
                          {
                            id: "bot-log-channel-id",
                            isTextBased: () => true,
                            name: "bot-log",
                            parentId: null,
                            permissionsFor: () => ({
                              has: () => true,
                            }),
                            position: 1,
                            type: 0,
                            viewable: true,
                          },
                        ],
                      ]),
                    ),
                },
                iconURL: () => "https://cdn.discordapp.com/icons/guild-id/icon.png",
                id: "guild-id",
                memberCount: 42,
                members: {
                  me: {
                    permissions: {
                      bitfield: 268435456n,
                    },
                  },
                },
                name: "Raid Server",
                ownerId: "owner-id",
                roles: {
                  fetch: () =>
                    Promise.resolve(
                      new Map([
                        [
                          "template-role-id",
                          {
                            colors: {
                              primaryColor: 0x22c55e,
                            },
                            editable: true,
                            hoist: false,
                            id: "template-role-id",
                            managed: false,
                            mentionable: true,
                            name: "Upcoming Raider Template",
                            permissions: {
                              bitfield: 0n,
                            },
                            position: 4,
                          },
                        ],
                      ]),
                    ),
                },
              }),
          },
        } as never,
        context,
      }),
    );

    await expect(
      postAction(baseUrl, {
        data: {
          discord_guild_id: "guild-id",
        },
        event: "discord.guild.snapshot_requested",
      }),
    ).resolves.toMatchObject({
      body: {
        event: "discord.guild.snapshot_requested",
        result: {
          channelCount: 1,
          discordGuildId: "guild-id",
          memberCount: 42,
          roleCount: 1,
          snapshot: {
            available_options: {
              bot_log_channels: [
                expect.objectContaining({
                  id: "bot-log-channel-id",
                  usable: true,
                }) as unknown,
              ],
              bot_moderator_roles: [
                expect.objectContaining({
                  id: "template-role-id",
                  usable: true,
                }) as unknown,
              ],
              run_announcement_channels: [
                expect.objectContaining({
                  id: "bot-log-channel-id",
                  usable: true,
                }) as unknown,
              ],
              run_role_template_roles: [
                expect.objectContaining({
                  id: "template-role-id",
                  usable: true,
                }) as unknown,
              ],
            },
            channels: [
              expect.objectContaining({
                id: "bot-log-channel-id",
                sendable_by_bot: true,
              }) as unknown,
            ],
            roles: [
              expect.objectContaining({
                id: "template-role-id",
                usable_as_run_template: true,
              }) as unknown,
            ],
            settings: {
              bot_log_channel_id: "bot-log-channel-id",
              bot_moderator_role_id: "bot-moderator-role-id",
              linked_at: "2026-06-01T10:00:00.000Z",
              run_announcement_channel_id: "run-announcement-channel-id",
              run_role_template_id: "template-role-id",
              sync_discord_names_to_ff14: true,
              upcoming_raider_role_id: "template-role-id",
            },
          },
        },
      },
      status: 200,
    });
  });

  it("returns cached guild member IDs for adoption snapshots without fetching Discord live", async () => {
    const refreshRequests: unknown[] = [];
    const context: BotContext = {
      ...createContext(),
      guildSettings: {
        get: (guildId) =>
          Promise.resolve({
            guildId,
            linkedAt: "2026-06-01T10:00:00.000Z",
            syncDiscordNamesToFf14: false,
          }),
        update: (guildId) => Promise.resolve({ guildId, syncDiscordNamesToFf14: false }),
      },
      guildMemberCache: {
        getSnapshot: (guildId: string, options?: { includeUserIds?: boolean }) =>
          Promise.resolve({
            cacheAgeSeconds: 3600,
            cachedMemberCount: 2,
            discordGuildId: guildId,
            ...(options?.includeUserIds ? { discordUserIds: ["123", "456"] } : {}),
            lastError: null,
            lastFullRefreshAt: "2026-05-30T10:00:00.000Z",
            memberCount: 3,
            nextRefreshAfter: "2026-05-30T11:00:00.000Z",
            refreshStatus: "stale",
            stale: true,
            updatedAt: "2026-05-30T10:00:00.000Z",
          }),
      } as never,
      guildMemberCacheScheduler: {
        enqueueRefresh: (guildId: string, reason: string) => {
          refreshRequests.push({ guildId, reason });

          return Promise.resolve({
            alreadyQueued: false,
            discordGuildId: guildId,
            queued: true,
            reason,
          });
        },
      } as never,
    };
    const baseUrl = await listen(
      createTestServer({
        client: {
          guilds: {
            fetch: () => {
              throw new Error("Guild should not be fetched for cached snapshots.");
            },
          },
        } as never,
        context,
      }),
    );

    await expect(
      postAction(baseUrl, {
        data: {
          discord_guild_id: "guild-id",
          include_member_ids: true,
        },
        event: "discord.guild.membership_snapshot_requested",
      }),
    ).resolves.toMatchObject({
      body: {
        event: "discord.guild.membership_snapshot_requested",
        result: {
          configured: true,
          discordGuildId: "guild-id",
          linked: true,
          membershipCache: {
            cached_member_count: 2,
            discord_member_count: 3,
            discord_guild_id: "guild-id",
            discord_user_ids: ["123", "456"],
            member_count: 2,
            refresh_status: "stale",
            stale: true,
          },
          refreshQueued: true,
          refreshReason: "dashboard_request",
        },
      },
      status: 200,
    });
    expect(refreshRequests).toEqual([
      {
        guildId: "guild-id",
        reason: "dashboard_request",
      },
    ]);
  });

  it("does not return guild member IDs when the guild is not linked", async () => {
    const context: BotContext = {
      ...createContext(),
      guildMemberCache: {
        getSnapshot: () => {
          throw new Error("Unlinked guilds should not read member cache snapshots.");
        },
      } as never,
      guildMemberCacheScheduler: {
        enqueueRefresh: () => {
          throw new Error("Unlinked guilds should not queue member cache refreshes.");
        },
      } as never,
    };
    const baseUrl = await listen(createTestServer({ context }));

    await expect(
      postAction(baseUrl, {
        data: {
          discord_guild_id: "guild-id",
          include_member_ids: true,
        },
        event: "discord.guild.membership_snapshot_requested",
      }),
    ).resolves.toMatchObject({
      body: {
        event: "discord.guild.membership_snapshot_requested",
        result: {
          configured: true,
          discordGuildId: "guild-id",
          linked: false,
          membershipCache: null,
          refreshQueued: false,
        },
      },
      status: 200,
    });
  });

  it("updates guild settings from FullParty dashboard events", async () => {
    const patches: unknown[] = [];
    const context: BotContext = {
      ...createContext(),
      guildSettings: {
        get: (guildId) => Promise.resolve({ guildId, syncDiscordNamesToFf14: false }),
        update: (guildId, patch) => {
          patches.push({ guildId, patch });
          const settings = {
            guildId,
            syncDiscordNamesToFf14: patch.syncDiscordNamesToFf14 ?? false,
          };

          return Promise.resolve({
            ...settings,
            ...(patch.botModeratorRoleId
              ? { botModeratorRoleId: patch.botModeratorRoleId }
              : {}),
            ...(patch.upcomingRaiderRoleId
              ? { upcomingRaiderRoleId: patch.upcomingRaiderRoleId }
              : {}),
          });
        },
      },
    };
    const baseUrl = await listen(createTestServer({ context }));

    await expect(
      postAction(baseUrl, {
        data: {
          discord_guild_id: "guild-id",
          settings: {
            bot_log_channel_id: null,
            bot_moderator_role_id: "bot-moderator-role-id",
            linked_at: expect.any(String) as string,
            run_role_template_id: "template-role-id",
            sync_discord_names_to_ff14: true,
          },
        },
        event: "discord.guild.settings_updated",
      }),
    ).resolves.toMatchObject({
      body: {
        event: "discord.guild.settings_updated",
        result: {
          discordGuildId: "guild-id",
          settings: {
            bot_log_channel_id: null,
            bot_moderator_role_id: "bot-moderator-role-id",
            run_role_template_id: "template-role-id",
            sync_discord_names_to_ff14: true,
            upcoming_raider_role_id: "template-role-id",
          },
          updated: true,
        },
      },
      status: 200,
    });
    expect(patches).toEqual([
      {
        guildId: "guild-id",
        patch: {
          botLogChannelId: null,
          botModeratorRoleId: "bot-moderator-role-id",
          linkedAt: expect.any(String) as string,
          syncDiscordNamesToFf14: true,
          upcomingRaiderRoleId: "template-role-id",
        },
      },
    ]);
  });

  it("rejects unsupported events", async () => {
    const baseUrl = await listen(createTestServer());

    await expect(
      postAction(baseUrl, {
        event: "unknown",
      }),
    ).resolves.toMatchObject({
      body: {
        error: "unsupported_event",
      },
      status: 400,
    });
  });

  it("stores the most recent signed event payload", async () => {
    const context = createContext();
    const payload = {
      data: {
        discord_user: {
          id: "discord-user-id",
        },
      },
      event: "discord.user_app.installed",
    };
    const baseUrl = await listen(
      createTestServer({
        client: {
          users: {
            fetch: () =>
              Promise.resolve({
                send: () => Promise.resolve({ id: "stored-payload-message-id" }),
              }),
          },
        } as never,
        context,
      }),
    );

    await expect(postAction(baseUrl, payload)).resolves.toMatchObject({
      status: 200,
    });
    expect(context.payloads.get()).toMatchObject({
      payload,
    });
  });

  function createTestServer(overrides: Partial<WebhookServerOptions> = {}): Server {
    const server = createWebhookServer({
      client: {
        channels: { fetch: () => Promise.resolve(null) },
        isReady: () => true,
        user: {
          id: "bot-user-id",
        },
        ws: {
          ping: 42,
        },
      } as never,
      context: createContext(),
      fullpartyWebBaseUrl: "https://fullparty.gg",
      host: "127.0.0.1",
      port: 0,
      webhookSigningSecret: "secret",
      ...overrides,
    });

    servers.push(server);

    return server;
  }

  async function listen(server: Server): Promise<string> {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected server to listen on a TCP port.");
    }

    return `http://127.0.0.1:${String(address.port)}`;
  }
});

type FetchJsonResponse = {
  body: unknown;
  status: number;
};

type FetchTextResponse = {
  body: string;
  contentType: string | null;
  status: number;
};

function postAction(baseUrl: string, body: unknown): Promise<FetchJsonResponse> {
  const rawBody = JSON.stringify(body);
  const timestamp = currentTimestamp();

  return fetchJson(`${baseUrl}/events`, {
    body: rawBody,
    headers: {
      "content-type": "application/json",
      "x-fullparty-signature": signBody(timestamp, rawBody),
      "x-fullparty-timestamp": timestamp,
    },
    method: "POST",
  });
}

async function fetchText(url: string, init?: RequestInit): Promise<FetchTextResponse> {
  const response = await fetch(url, init);

  return {
    body: await response.text(),
    contentType: response.headers.get("content-type"),
    status: response.status,
  };
}

async function fetchJson(url: string, init?: RequestInit): Promise<FetchJsonResponse> {
  const response = await fetch(url, init);

  return {
    body: await response.json(),
    status: response.status,
  };
}

function createContext(): BotContext {
  return {
    fullparty: {
      health: () => Promise.resolve({ status: "ok" }),
    } as never,
    fullpartyWebBaseUrl: "https://fullparty.gg",
    guildSettings: {
      get: (guildId) => Promise.resolve({ guildId, syncDiscordNamesToFf14: false }),
      update: (guildId) => Promise.resolve({ guildId, syncDiscordNamesToFf14: false }),
    },
    logger: {
      debug: () => undefined,
      error: () => undefined,
      info: () => undefined,
      warn: () => undefined,
    },
    payloads: new LatestPayloadStore(),
  };
}

function createMemoryRunRoleStore(): NonNullable<BotContext["guildRunRoles"]> {
  const mappings = new Map<string, GuildRunRoleMapping>();

  return {
    get: (discordGuildId, runId) =>
      Promise.resolve(mappings.get(`${discordGuildId}:${String(runId)}`)),
    markDeleted: (discordGuildId, runId) => {
      const key = `${discordGuildId}:${String(runId)}`;
      const mapping = mappings.get(key);

      if (mapping) {
        mappings.set(key, {
          ...mapping,
          deletedAt: new Date().toISOString(),
          status: "deleted",
          updatedAt: new Date().toISOString(),
        });
      }

      return Promise.resolve();
    },
    upsert: (mapping) => {
      mappings.set(`${mapping.discordGuildId}:${String(mapping.runId)}`, mapping);

      return Promise.resolve(mapping);
    },
  };
}

function createAdminStore(overrides: Partial<AdminStore> = {}): AdminStore {
  return {
    getAutomationRuns: () => Promise.resolve([]),
    getCommandUsages: () => Promise.resolve([]),
    getDashboardMetrics: () =>
      Promise.resolve({
        breakdowns: {
          automationStatuses24h: [],
          commandNames24h: [],
          dmStatuses24h: [],
          eventTypes24h: [],
          guildMessageStatuses24h: [],
          notificationTypes24h: [],
        },
        totals: {
          automationFailures24h: 0,
          automationRuns24h: 0,
          commandsFailed24h: 0,
          commandsUsed24h: 0,
          dmsFailed24h: 0,
          dmsQueued24h: 0,
          dmsSent24h: 0,
          events24h: 0,
          eventsFailed24h: 0,
          failures24h: 0,
          guildMessagesFailed24h: 0,
          guildMessagesSent24h: 0,
        },
        trends: {
          daily7d: [],
          hourly24h: [],
        },
      }),
    getDmDeliveries: () => Promise.resolve([]),
    getEvents: () => Promise.resolve([]),
    getFailures: () => Promise.resolve([]),
    getGuildDashboards: () => Promise.resolve([]),
    getGuildMessages: () => Promise.resolve([]),
    getGuilds: () => Promise.resolve([]),
    getQueueSummary: () =>
      Promise.resolve({
        jobsByStatus: {},
        oldestQueuedAt: null,
        recentFailedCount: 0,
      }),
    getSummary: () =>
      Promise.resolve({
        automationRuns: {
          last1h: { byStatus: {}, total: 0 },
          last24h: { byStatus: {}, total: 0 },
        },
        commandUsages: {
          last1h: { byStatus: {}, total: 0 },
          last24h: { byStatus: {}, total: 0 },
        },
        dmDeliveries: {
          last1h: { byStatus: {}, total: 0 },
          last24h: { byStatus: {}, total: 0 },
        },
        events: {
          last1h: { byStatus: {}, total: 0 },
          last24h: { byStatus: {}, total: 0 },
        },
        guildMessages: {
          last1h: { byStatus: {}, total: 0 },
          last24h: { byStatus: {}, total: 0 },
        },
      }),
    recordAutomationRun: () => Promise.resolve(),
    recordBotEvent: () => Promise.resolve(),
    recordCommandUsage: () => Promise.resolve(),
    recordDmDelivery: () => Promise.resolve(),
    recordGuildMessage: () => Promise.resolve(),
    recordGuildRuntime: () => Promise.resolve(),
    ...overrides,
  };
}

function currentTimestamp(): string {
  return String(Math.floor(Date.now() / 1000));
}

function signBody(timestamp: string, rawBody: string): string {
  const digest = createHmac("sha256", "secret")
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  return `sha256=${digest}`;
}
