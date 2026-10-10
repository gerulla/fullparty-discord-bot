import { messageComponents, messageText } from "./helpers/messages.js";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MessageCreateOptions } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminStore } from "@fullparty/admin";
import type { BotContext } from "../src/bot/context.js";
import { SqliteDmQueueStore } from "../src/dm/queueStore.js";
import { UserDmRateLimiter } from "../src/dm/userDmRateLimiter.js";
import { replyWithAutomationFailureDetails } from "../src/guildAutomation/automationFailureDetails.js";
import { GuildAutomationService } from "../src/guildAutomation/automationService.js";
import { SqliteGuildRunReminderQueue } from "../src/guildAutomation/runReminderQueue.js";
import type { GuildRunRoleMapping } from "../src/guildAutomation/runRoleStore.js";
import { createWebhookServer, stopWebhookServer } from "../src/http/server.js";
import type { WebhookServerOptions } from "../src/http/types.js";
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

  it("queues guild member cache refreshes from the admin API", async () => {
    const refreshCalls: string[] = [];
    const context: BotContext = {
      ...createContext(),
      adminStore: createAdminStore(),
      guildMemberCacheScheduler: {
        getHealthSummary: () =>
          Promise.resolve({
            cachedGuildCount: 0,
            failedGuildCount: 0,
            ok: true,
            oldestCacheAgeSeconds: null,
            processing: 0,
            queued: 0,
            running: true,
            staleGuildCount: 0,
            status: "healthy",
          }),
        refreshLinkedGuildsFromDashboard: () => {
          refreshCalls.push("refresh");

          return Promise.resolve({
            deletedUnavailableGuildCount: 2,
            linkedGuildCount: 3,
            obsoleteUnavailableGuildCount: 2,
            queuedGuildCount: 3,
            skippedGuildCount: 0,
          });
        },
      } as BotContext["guildMemberCacheScheduler"],
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
      fetchJson(`${baseUrl}/admin/api/guild-member-cache/refresh`, {
        headers: {
          authorization: "Bearer admin-token",
        },
        method: "POST",
      }),
    ).resolves.toMatchObject({
      body: {
        data: {
          deletedUnavailableGuildCount: 2,
          linkedGuildCount: 3,
          obsoleteUnavailableGuildCount: 2,
          queuedGuildCount: 3,
          skippedGuildCount: 0,
        },
      },
      status: 202,
    });
    expect(refreshCalls).toEqual(["refresh"]);
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
    const context = createContext();
    const unavailable = () => {
      throw new Error("Integration healthchecks must not wait for dependencies.");
    };
    context.fullparty.health = unavailable;
    context.failureReporter = { getHealthSummary: unavailable, record: unavailable };
    context.guildRunReminderQueue = {
      enqueue: unavailable,
      getHealthSummary: unavailable,
    };
    const baseUrl = await listen(createTestServer({ context }));
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
        account_settings_url: "https://fullparty.gg/account/notifications",
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
    expect(sentMessages).toHaveLength(1);
    expectV2Message(sentMessages[0]);
    expect(messageText(sentMessages[0])).toContain("Welcome aboard.");
    expect(messageText(sentMessages[0])).toContain("`/help`");
    expect(messageComponents(sentMessages[0])).toContainEqual(
      expect.objectContaining({
        label: "Account Settings",
        url: payload.data.account_settings_url,
      }),
    );
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
    expect(sentMessages).toHaveLength(1);
    expectV2Message(sentMessages[0]);
    expect(messageText(sentMessages[0])).toMatch(
      /Thank you for connecting your Discord account/iu,
    );
    expect(messageText(sentMessages[0])).toContain("`/help`");
    expect(messageText(sentMessages[0])).toContain("FullParty account settings");
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
        feedback_url: "https://fullparty.gg/feedback",
        disconnect_guide_image_url: "https://fullparty.gg/images/discord-disconnect.png",
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
    expect(sentMessages).toHaveLength(1);
    expectV2Message(sentMessages[0]);
    expect(messageText(sentMessages[0])).toMatch(
      /has been disconnected from your account/iu,
    );
    expect(messageText(sentMessages[0])).toContain("Authorized Apps");
    expect(messageComponents(sentMessages[0])).toContainEqual(
      expect.objectContaining({
        label: "Leave Feedback",
        url: payload.data.feedback_url,
      }),
    );
    expect(messageComponents(sentMessages[0])).toContainEqual(
      expect.objectContaining({
        type: 12,
        items: [{ media: { url: payload.data.disconnect_guide_image_url } }],
      }),
    );
  });

  it("queues a standalone Discord login event without notification delivery IDs", async () => {
    const context = createContext();
    const store = new SqliteDmQueueStore(":memory:");
    const limiter = new UserDmRateLimiter({
      store,
      logger: context.logger,
      startPaused: true,
    });
    context.userDmRateLimiter = limiter;
    const send = vi
      .fn<(message: unknown) => Promise<{ id: string }>>()
      .mockResolvedValue({ id: "login-welcome-message" });
    const fetchUser = vi.fn(() => Promise.resolve({ send }));
    const baseUrl = await listen(
      createTestServer({
        context,
        client: { users: { fetch: fetchUser } } as never,
      }),
    );
    const payload = {
      ...discordLoginEvent(),
      data: {
        ...discordLoginEvent().data,
        account_settings_url: "https://fullparty.gg/account/notifications",
      },
    };

    try {
      await expect(postAction(baseUrl, payload)).resolves.toMatchObject({
        status: 200,
        body: {
          ok: true,
          event: "user.discord_login",
          result: {
            queued: true,
            discordUserId: payload.data.discord_user_id,
          },
        },
      });
      expect(store.pending()).toMatchObject([
        {
          payload: {
            discordUserId: payload.data.discord_user_id,
            message: { flags: 32768 },
            metadata: {
              eventType: "user.discord_login",
              notificationType: "user.discord_login",
            },
          },
        },
      ]);
      expect(store.pending()[0]?.payload.metadata).not.toHaveProperty(
        "notificationDeliveryId",
      );
      expect(fetchUser).not.toHaveBeenCalled();

      limiter.resume();
      await vi.waitFor(() => {
        expect(store.pending()).toEqual([]);
      });
      expect(fetchUser).toHaveBeenCalledExactlyOnceWith(payload.data.discord_user_id);
      expect(send).toHaveBeenCalledOnce();
      const message = send.mock.calls[0]?.[0] as MessageCreateOptions;
      expectV2Message(message);
      expect(messageText(message)).toContain("Welcome to FullParty");
      expect(messageText(message)).toContain("Automated Setup");
      expect(messageText(message)).toContain("Manual Setup");
      expect(messageText(message)).toContain("`/link token:<code>`");
      expect(messageComponents(message)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label: "Finish Discord Setup",
            url: payload.data.discord_app_install_url,
          }),
          expect.objectContaining({
            label: "Account Settings",
            url: payload.data.account_settings_url,
          }),
        ]),
      );
    } finally {
      limiter.stop();
      await limiter.waitForIdle();
      store.close();
    }
  });

  it.each([
    ["absent", undefined],
    ["null", null],
    ["unsafe", "javascript:alert(1)"],
    ["credential-bearing", "https://user:password@fullparty.gg/private"],
  ])(
    "delivers V2 account events with %s optional presentation URLs",
    async (_name, url) => {
      const send = vi
        .fn<(message: unknown) => Promise<{ id: string }>>()
        .mockResolvedValue({ id: "account-message-id" });
      const fetchUser = vi.fn(() => Promise.resolve({ send }));
      const baseUrl = await listen(
        createTestServer({ client: { users: { fetch: fetchUser } } as never }),
      );
      const login = discordLoginEvent();
      const events = [
        {
          event: "discord.user_app.installed",
          data: {
            discord_user: { id: login.data.discord_user_id },
            account_settings_url: url,
          },
        },
        {
          event: "discord.user_app.disconnected",
          data: {
            discord_user: { id: login.data.discord_user_id },
            feedback_url: url,
            disconnect_guide_image_url: url,
          },
        },
        { ...login, data: { ...login.data, account_settings_url: url } },
      ];

      for (const event of events) {
        await expect(postAction(baseUrl, event)).resolves.toMatchObject({ status: 200 });
      }
      expect(send).toHaveBeenCalledTimes(3);
      for (const [message] of send.mock.calls) {
        expectV2Message(message);
        expect(JSON.stringify(message)).not.toContain("javascript:");
        expect(JSON.stringify(message)).not.toContain("user:password");
      }
      expect(
        messageComponents(send.mock.calls[1]?.[0]).some(({ type }) => type === 12),
      ).toBe(false);
    },
  );

  it("skips Discord login onboarding when the app is already installed", async () => {
    const fetchUser = vi.fn();
    const baseUrl = await listen(
      createTestServer({ client: { users: { fetch: fetchUser } } as never }),
    );
    const payload = discordLoginEvent();

    await expect(
      postAction(baseUrl, {
        ...payload,
        data: { ...payload.data, discord_app_installed: true },
      }),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        ok: true,
        result: {
          discordUserId: payload.data.discord_user_id,
          reason: "discord_app_already_installed",
          skipped: true,
        },
      },
    });
    expect(fetchUser).not.toHaveBeenCalled();
  });

  it.each([
    ["a nonnumeric Discord ID", { discord_user_id: "not-a-discord-id" }],
    ["a numeric Discord ID", { discord_user_id: 123 }],
    ["a missing Discord ID", { discord_user_id: undefined }],
    ["a string installation flag", { discord_app_installed: "false" }],
    ["a missing installation flag", { discord_app_installed: undefined }],
    ["a missing install URL", { discord_app_install_url: undefined }],
    ["a script install URL", { discord_app_install_url: "javascript:alert(1)" }],
    ["a file install URL", { discord_app_install_url: "file:///local/install" }],
    [
      "a relative install URL",
      { discord_app_install_url: "/auth/discord-app/user/redirect" },
    ],
    [
      "an install URL containing credentials",
      { discord_app_install_url: "https://user:password@fullparty.gg/install" },
    ],
  ])(
    "rejects Discord login onboarding with %s before sending",
    async (_name, changes) => {
      const fetchUser = vi.fn();
      const baseUrl = await listen(
        createTestServer({ client: { users: { fetch: fetchUser } } as never }),
      );
      const payload = discordLoginEvent();

      await expect(
        postAction(baseUrl, { ...payload, data: { ...payload.data, ...changes } }),
      ).resolves.toMatchObject({ status: 400 });
      expect(fetchUser).not.toHaveBeenCalled();
    },
  );

  it("requires a signature before handling a standalone Discord login event", async () => {
    const fetchUser = vi.fn();
    const baseUrl = await listen(
      createTestServer({ client: { users: { fetch: fetchUser } } as never }),
    );

    await expect(
      fetchJson(`${baseUrl}/events`, {
        body: JSON.stringify(discordLoginEvent()),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    ).resolves.toMatchObject({
      status: 401,
      body: { error: "missing_signature" },
    });
    expect(fetchUser).not.toHaveBeenCalled();
  });

  it("queues signed Discord login onboarding for the payload recipient", async () => {
    const context = createContext();
    const store = new SqliteDmQueueStore(":memory:");
    const limiter = new UserDmRateLimiter({
      store,
      logger: context.logger,
      startPaused: true,
    });
    context.userDmRateLimiter = limiter;
    const send = vi
      .fn<(message: unknown) => Promise<{ id: string }>>()
      .mockResolvedValue({ id: "login-welcome-message" });
    const fetchUser = vi.fn(() => Promise.resolve({ send }));
    const baseUrl = await listen(
      createTestServer({
        context,
        client: { users: { fetch: fetchUser } } as never,
      }),
    );
    const actionUrl = "https://fullparty.gg/en/settings/discord";

    try {
      await expect(
        postAction(baseUrl, {
          event: "discord.notification.delivery",
          data: {
            type: "user.discord_login",
            category: "account_character_updates",
            discord_user: { id: "234567890123456789" },
            notification_delivery_id: 321,
            notification_event_id: 654,
            notification: {
              type: "user.discord_login",
              category: "account_character_updates",
              action_url: actionUrl,
            },
          },
        }),
      ).resolves.toMatchObject({
        status: 200,
        body: {
          ok: true,
          result: {
            queued: true,
            discordUserId: "234567890123456789",
            notificationDeliveryId: 321,
            notificationEventId: 654,
            type: "user.discord_login",
          },
        },
      });
      expect(store.pending()).toMatchObject([
        {
          payload: {
            discordUserId: "234567890123456789",
            metadata: {
              eventType: "discord.notification.delivery",
              notificationDeliveryId: 321,
              notificationType: "user.discord_login",
            },
          },
        },
      ]);
      expect(fetchUser).not.toHaveBeenCalled();

      limiter.resume();
      await vi.waitFor(() => {
        expect(store.pending()).toEqual([]);
      });
      expect(fetchUser).toHaveBeenCalledExactlyOnceWith("234567890123456789");
      expect(send).toHaveBeenCalledOnce();
      const message = send.mock.calls[0]?.[0] as MessageCreateOptions;
      expectV2Message(message);
      expect(messageText(message)).toContain("Welcome to FullParty");
      expect(messageText(message)).toMatch(/authoriz/iu);
      expect(messageText(message)).toContain("Manual Setup");
      expect(messageComponents(message)).toContainEqual(
        expect.objectContaining({ label: "Finish Discord Setup", url: actionUrl }),
      );
    } finally {
      limiter.stop();
      await limiter.waitForIdle();
      store.close();
    }
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
      nonce: expect.stringMatching(/^[a-f0-9]{24}$/u) as unknown,
      enforceNonce: true,
      flags: 32768,
      allowedMentions: {
        parse: [],
        repliedUser: false,
      },
      components: [
        {
          type: 17,
          accent_color: 6539064,
          components: [
            {
              type: 10,
              content:
                "## 🔄 Roster assignment updated\nYou were assigned on the roster for **Your run**.",
            },
          ],
        },
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5,
              label: "View Assignment",
              url: "https://fullparty.gg/groups/example/activities/99",
            },
          ],
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

  it.each(
    [
      { key: "trapper", label: "Trapper", activity: "BA Weekly Run" },
      { key: "trapper", label: "Trapper", activity: "DRS Weekly Run" },
      { key: "darter", label: "Darter", activity: "BA Weekly Run" },
      { key: "duelist", label: "Duelist", activity: "DRS Weekly Run" },
    ].flatMap((designation) =>
      [true, false].map((assigned) => ({ ...designation, assigned })),
    ),
  )(
    "delivers $label for $activity with designation_assigned=$assigned",
    async ({ key, label, activity, assigned }) => {
      const context = createContext();
      const send = vi
        .fn<(message: unknown) => Promise<{ id: string }>>()
        .mockResolvedValue({ id: "designation-dm-message-id" });
      const fetchUser = vi.fn(() => Promise.resolve({ send }));
      const baseUrl = await listen(
        createTestServer({
          context,
          client: { users: { fetch: fetchUser } } as never,
        }),
      );
      const type = assigned
        ? "assignments.designation_assigned"
        : "assignments.designation_removed";
      const payload = {
        event: "discord.notification.delivery",
        data: {
          type,
          category: "assignments",
          discord_user: { id: "234567890123456789" },
          notification_delivery_id: 123,
          notification_event_id: 456,
          user: { id: 42, name: "FullParty account name" },
          notification: {
            type,
            category: "assignments",
            action_url: "/groups/example-raiders/activities/195",
            params: {
              activity,
              group: "Example Raiders",
              character: "Luna Crest",
              slot: "Party A 1",
              slot_group: "Party A",
              designation: "Stale designation label",
            },
            payload: {
              activity_id: 195,
              group_id: 1,
              character_id: 42,
              slot_id: 1234,
              designation_key: key,
              designation_label: label,
              designation_assigned: assigned,
              run_url: "https://fullparty.gg/older-run-url",
            },
          },
        },
      };

      await expect(postAction(baseUrl, payload)).resolves.toMatchObject({
        status: 200,
        body: {
          ok: true,
          event: "discord.notification.delivery",
          result: {
            discordUserId: "234567890123456789",
            notificationDeliveryId: 123,
            notificationEventId: 456,
            type,
          },
        },
      });
      expect(fetchUser).toHaveBeenCalledExactlyOnceWith("234567890123456789");
      expect(send).toHaveBeenCalledOnce();
      const message = send.mock.calls[0]?.[0];
      expect(message).toMatchObject({
        flags: 32768,
        allowedMentions: { parse: [], repliedUser: false },
      });
      expect(messageText(message)).toContain(
        `${label} ${assigned ? "assigned" : "removed"}`,
      );
      expect(messageText(message)).toContain(activity);
      expect(messageText(message)).not.toContain("Stale designation label");
      expect(
        messageComponents(message).filter((component) => component.type === 2),
      ).toEqual([
        {
          type: 2,
          style: 5,
          label: "View run",
          url: "https://fullparty.gg/groups/example-raiders/activities/195",
        },
      ]);
      expect(context.payloads.get()).toMatchObject({ payload });
    },
  );

  it("rejects an unsigned designation delivery before fetching the Discord user", async () => {
    const fetchUser = vi.fn();
    const baseUrl = await listen(
      createTestServer({ client: { users: { fetch: fetchUser } } as never }),
    );

    await expect(
      fetchJson(`${baseUrl}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          event: "discord.notification.delivery",
          data: {
            type: "assignments.designation_assigned",
            category: "assignments",
            discord_user: { id: "234567890123456789" },
            notification_delivery_id: 123,
            notification_event_id: 456,
            notification: {
              type: "assignments.designation_assigned",
              category: "assignments",
              payload: {
                designation_key: "trapper",
                designation_label: "Trapper",
                designation_assigned: true,
              },
            },
          },
        }),
      }),
    ).resolves.toMatchObject({
      status: 401,
      body: { error: "missing_signature" },
    });
    expect(fetchUser).not.toHaveBeenCalled();
  });

  it("deduplicates a signed designation delivery before queueing a second DM", async () => {
    const context = createContext();
    const store = new SqliteDmQueueStore(":memory:");
    const limiter = new UserDmRateLimiter({
      store,
      logger: context.logger,
      startPaused: true,
    });
    context.userDmRateLimiter = limiter;
    const send = vi
      .fn<(message: unknown) => Promise<{ id: string }>>()
      .mockResolvedValue({ id: "designation-message" });
    const fetchUser = vi.fn(() => Promise.resolve({ send }));
    const baseUrl = await listen(
      createTestServer({
        context,
        client: { users: { fetch: fetchUser } } as never,
      }),
    );
    const rawBody = JSON.stringify({
      id: "designation-request-id",
      event: "discord.notification.delivery",
      data: {
        type: "assignments.designation_assigned",
        category: "assignments",
        discord_user: { id: "234567890123456789" },
        notification_delivery_id: 123,
        notification_event_id: 456,
        notification: {
          type: "assignments.designation_assigned",
          category: "assignments",
          action_url: "https://fullparty.gg/groups/example/activities/195",
          params: { activity: "BA Weekly Run" },
          payload: {
            activity_id: 195,
            designation_key: "trapper",
            designation_label: "Trapper",
            designation_assigned: true,
          },
        },
      },
    });
    const timestamp = currentTimestamp();
    const request: RequestInit = {
      method: "POST",
      body: rawBody,
      headers: {
        "content-type": "application/json",
        "x-fullparty-signature": signBody(timestamp, rawBody),
        "x-fullparty-timestamp": timestamp,
      },
    };

    try {
      await expect(fetchJson(`${baseUrl}/events`, request)).resolves.toMatchObject({
        status: 200,
        body: {
          ok: true,
          result: {
            queued: true,
            discordUserId: "234567890123456789",
            notificationDeliveryId: 123,
          },
        },
      });
      await expect(fetchJson(`${baseUrl}/events`, request)).resolves.toMatchObject({
        status: 200,
        body: {
          ok: true,
          result: { duplicate: true, notificationDeliveryId: 123 },
        },
      });
      expect(store.pending()).toHaveLength(1);
      expect(fetchUser).not.toHaveBeenCalled();

      limiter.resume();
      await vi.waitFor(() => {
        expect(store.pending()).toEqual([]);
      });
      expect(fetchUser).toHaveBeenCalledExactlyOnceWith("234567890123456789");
      expect(send).toHaveBeenCalledOnce();
      expect(messageText(send.mock.calls[0]?.[0])).toContain("Trapper assigned");
    } finally {
      limiter.stop();
      await limiter.waitForIdle();
      store.close();
    }
  });

  it.each(["fetch", "send"])(
    "acknowledges a persisted notification before a slow Discord %s finishes",
    async (slowOperation) => {
      const context = createContext();
      const store = new SqliteDmQueueStore(":memory:");
      const limiter = new UserDmRateLimiter({ store, logger: context.logger });
      context.userDmRateLimiter = limiter;
      let releaseDiscord: () => void = () => undefined;
      const discordReady = new Promise<void>((resolve) => {
        releaseDiscord = resolve;
      });
      const send = vi.fn(async () => {
        if (slowOperation === "send") await discordReady;
        return { id: "notification-message" };
      });
      const fetchUser = vi.fn(async () => {
        if (slowOperation === "fetch") await discordReady;
        return { send };
      });
      const baseUrl = await listen(
        createTestServer({
          context,
          client: { users: { fetch: fetchUser } } as never,
        }),
      );

      try {
        await expect(
          postAction(
            baseUrl,
            {
              event: "discord.notification.delivery",
              data: {
                category: "assignments",
                discord_user: { id: "discord-user-id" },
                notification: { category: "assignments", type: "assignments.assigned" },
                notification_delivery_id: 123,
                notification_event_id: 456,
                type: "assignments.assigned",
              },
            },
            AbortSignal.timeout(2000),
          ),
        ).resolves.toMatchObject({
          status: 200,
          body: {
            ok: true,
            event: "discord.notification.delivery",
            result: {
              discordUserId: "discord-user-id",
              notificationDeliveryId: 123,
              queued: true,
              rateLimited: false,
            },
          },
        });
        expect(store.pending()).toMatchObject([
          {
            payload: {
              discordUserId: "discord-user-id",
              metadata: {
                eventType: "discord.notification.delivery",
                notificationType: "assignments.assigned",
              },
            },
          },
        ]);
        releaseDiscord();
        await vi.waitFor(() => {
          expect(store.pending()).toEqual([]);
        });
        expect(fetchUser).toHaveBeenCalledExactlyOnceWith("discord-user-id");
        expect(send).toHaveBeenCalledOnce();
      } finally {
        releaseDiscord();
        limiter.stop();
        await limiter.waitForIdle();
        store.close();
      }
    },
  );

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
          unlinked_participants: [],
        },
        kind: "run_reminder",
      },
    ]);
  });

  it("accepts and deduplicates reminders while the queued Discord start notice is pending", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fullparty-reminder-acceptance-"));
    tempDirs.push(directory);
    let releaseDiscord: () => void = () => undefined;
    const discordSend = new Promise<void>((resolve) => {
      releaseDiscord = resolve;
    });
    const send = vi.fn(() => discordSend);
    const processor = vi.fn(() => Promise.resolve({ ok: true }));
    const client = {
      channels: { fetch: () => Promise.resolve({ send }) },
    } as never;
    const context = createContext();
    context.guildSettings.get = (guildId) =>
      Promise.resolve({
        botLogChannelId: "bot-log-channel-id",
        guildId,
        syncDiscordNamesToFf14: false,
      });
    const automation = new GuildAutomationService({ client, context });
    const queue = new SqliteGuildRunReminderQueue({
      databasePath: join(directory, "queue.sqlite"),
      logger: context.logger,
      onFirstAttempt: (job) =>
        job.kind === "run_reminder"
          ? automation.notifyStarted(job.data)
          : Promise.resolve(),
      processor,
    });
    context.guildRunReminderQueue = queue;
    queue.start();
    const baseUrl = await listen(createTestServer({ client, context }));
    const event = {
      data: {
        discord_guild_id: "900100200300400500",
        discord_user_ids: ["123"],
        participants: [],
        reminder_type: "starting_soon",
        run_id: 123,
        type: "runs.starting_soon",
      },
      event: "discord.guild.run_reminder",
    };

    try {
      await expect(
        postAction(baseUrl, event, AbortSignal.timeout(1000)),
      ).resolves.toMatchObject({
        body: { result: { alreadyQueued: false, queued: true } },
        status: 200,
      });
      await vi.waitFor(() => {
        expect(send).toHaveBeenCalledOnce();
      });
      await expect(
        postAction(baseUrl, event, AbortSignal.timeout(1000)),
      ).resolves.toMatchObject({
        body: { result: { alreadyQueued: true, queued: true } },
        status: 200,
      });
      expect(send).toHaveBeenCalledOnce();
      expect(processor).not.toHaveBeenCalled();

      releaseDiscord();
      await vi.waitFor(() => {
        expect(processor).toHaveBeenCalledOnce();
      });
    } finally {
      releaseDiscord();
      await queue.stop();
    }
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
            runRoleTemplateOverrides: [
              {
                activityId: 123,
                activityName: "Cloud of Darkness",
                roleId: "abyssos-role-id",
              },
            ],
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
                                  roleId === "abyssos-role-id"
                                    ? {
                                        allow: { bitfield: 1024n },
                                        deny: { bitfield: 2048n },
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
                      roleId === "abyssos-role-id"
                        ? {
                            color: 0x22c55e,
                            hoist: false,
                            id: roleId,
                            mentionable: false,
                            name: "Abyssos Template",
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
                      roleId === "abyssos-role-id"
                        ? {
                            color: 0x22c55e,
                            hoist: false,
                            id: roleId,
                            mentionable: false,
                            name: "Abyssos Template",
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
          run: {
            activity_type: { name: { en: "Delubrum Reginae (Savage)" } },
            display_name: "Custom bridge progression night",
          },
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
          roleName: "Run: Delubrum Reginae (Savage) 21:00 UTC",
          runId: 123,
          templateOverrideActivityId: 123,
          templateOverrideActivityName: "Cloud of Darkness",
          templateRoleId: "abyssos-role-id",
          templateRoleSource: "override",
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
        name: "Run: Delubrum Reginae (Savage) 21:00 UTC",
        permissions: { bitfield: 0n },
      },
    ]);
    expect(channelOverwriteEdits).toEqual([
      {
        options: {
          SendMessages: false,
          ViewChannel: true,
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
    expect(logMessages).toHaveLength(3);
    expect(JSON.stringify(logMessages)).not.toContain("Processing Time");
    expect(JSON.stringify(logMessages)).not.toContain("Performance");
    expect(logMessages[0]).toMatchObject({
      allowedMentions: {
        parse: [],
      },
      content: expect.stringContaining(
        "⚙️ Automation started for Upcoming Run #123: Cloud of Darkness.",
      ) as string,
    });
    expect(logMessages[1]).toMatchObject({
      flags: 32768,
      allowedMentions: { parse: [] },
    });
    expect(messageText(logMessages[1])).toContain("Role Assignment - Success");
    expect(messageText(logMessages[1])).toContain("**Run #123** • Upcoming");
    expect(messageText(logMessages[1])).toContain("**2 / 2** users assigned");
    expect(messageText(logMessages[1])).toContain(
      "<@&abyssos-role-id> > <@&run-role-id>",
    );
    expect(messageText(logMessages[1])).toContain("1 overwrite copied");
    expect(logMessages[2]).toMatchObject({
      flags: 32768,
      allowedMentions: { parse: [] },
    });
    expect(messageText(logMessages[2])).toContain("Nickname Synchronization - Success");
    expect(messageText(logMessages[2])).toContain("1 user updated");
    expect(messageText(logMessages[2])).toContain("1 already correct");
    expect(messageText(logMessages[2])).toContain("0 users failed");
    expect(messageText(logMessages[2])).toContain("Primary character");
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
          failedUserCount: 1,
          requestedUserCount: 1,
          skippedReason: "upcoming_raider_role_not_configured",
          type: "runs.starting_now",
        },
      },
      status: 200,
    });
    expect(logMessages).toHaveLength(2);
    expect(JSON.stringify(logMessages)).not.toContain("Processing Time");
    expect(JSON.stringify(logMessages)).not.toContain("Performance");
    expect(logMessages[0]).toMatchObject({
      allowedMentions: {
        parse: [],
      },
      content:
        "⚙️ Automation started for Run #123 Starting Now.\nRole assignment and nickname sync status will follow here.",
    });
    expect(logMessages[1]).toMatchObject({
      flags: 32768,
      allowedMentions: { parse: [] },
    });
    expect(messageText(logMessages[1])).toContain("Role Assignment - Skipped");
    expect(messageText(logMessages[1])).toContain("Starting Now");
    expect(messageText(logMessages[1])).toContain("Not configured > Not created");
    expect(messageText(logMessages[1])).toContain(
      "Run role template is not configured in `/setup`.",
    );
  });

  it("adds a failure details button to partial guild run reminder automation logs", async () => {
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
                  fetch: (discordUserId: string) =>
                    discordUserId === "missing-user"
                      ? Promise.reject(new Error("Unknown Member"))
                      : Promise.resolve({
                          permissions: {
                            has: () => true,
                          },
                          roles: {
                            add: () => Promise.resolve({}),
                            highest: {
                              comparePositionTo: () => 1,
                              id: "bot-role-id",
                              name: "Bot Role",
                            },
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
                  fetch: () => Promise.resolve(new Map()),
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
                  create: () =>
                    Promise.resolve({
                      id: "run-role-id",
                      name: "FullParty: Cloud of Darkness 21:00 UTC",
                      permissions: { bitfield: 0n },
                    }),
                  fetch: (roleId: string) =>
                    Promise.resolve(
                      roleId === "upcoming-raider-role-id"
                        ? {
                            id: roleId,
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
          activity_title: "Cloud of Darkness",
          discord_guild_id: "900100200300400500",
          discord_user_ids: ["123", "missing-user"],
          participants: [],
          reminder_type: "starting_soon",
          run_id: 123,
          starts_at: "2026-05-30T21:00:00+00:00",
          type: "runs.starting_soon",
          unlinked_count: 1,
          unlinked_participants: [
            {
              character: {
                name: "No Discord",
                world: "Omega",
              },
              discord_user_id: null,
              group_role: null,
              is_discord_linked: false,
              is_group_member: false,
              source: "slot",
              user_id: 789,
            },
          ],
        },
        event: "discord.guild.run_reminder",
      }),
    ).resolves.toMatchObject({
      body: {
        result: {
          assignedUserCount: 1,
          failedUserCount: 2,
        },
      },
      status: 200,
    });

    expect(logMessages[1]).toMatchObject({
      flags: 32768,
      allowedMentions: { parse: [] },
    });
    expect(messageText(logMessages[1])).toContain("Role Assignment - Partial");
    expect(messageText(logMessages[1])).toContain("`missing-user`: Unknown Member");
    expect(messageText(logMessages[1])).toContain("Failure Details");

    const detailCustomId = messageComponents(logMessages[1]).find((c) =>
      c.custom_id?.startsWith("automationfailures:"),
    )?.custom_id;
    expect(detailCustomId).toBeDefined();
    const detailReplies: unknown[] = [];

    await replyWithAutomationFailureDetails({
      customId: detailCustomId,
      followUp: (message: unknown) => {
        detailReplies.push(message);

        return Promise.resolve({});
      },
      reply: (message: unknown) => {
        detailReplies.push(message);

        return Promise.resolve({});
      },
    } as never);

    expect(detailReplies).toEqual([
      expect.objectContaining({
        content: expect.stringContaining(
          "`No Discord [Omega]` - No Discord Account Linked. Group Member: no.",
        ) as string,
      }),
    ]);
    expect(JSON.stringify(detailReplies)).not.toContain("user 789");
    expect(JSON.stringify(detailReplies)).not.toContain("Source:");
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
            null,
            null,
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
      flags: 32768,
      allowedMentions: { parse: [] },
    });
    expect(messageText(logMessages[0])).toContain("Run Role Cleanup - Success");
    expect(messageText(logMessages[0])).toContain("Completed");
    expect(messageText(logMessages[0])).toContain(
      "FullParty: Cloud of Darkness 21:00 UTC",
    );
    expect(messageText(logMessages[0])).toContain("ID: `run-role-id`");
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
      flags: 32768,
      allowedMentions: { parse: [] },
    });
    expect(messageText(logMessages[0])).toContain("Run Role Cleanup - Success");
    expect(messageText(logMessages[0])).toContain("Cancelled");
    expect(messageText(logMessages[0])).toContain("cancelled-run-role-id");
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
    expect(logMessages).toHaveLength(2);
    expect(logMessages[1]).toMatchObject({
      flags: 32768,
      allowedMentions: { parse: [] },
    });
    expect(messageText(logMessages[1])).toContain("Role Assignment - Skipped");
    expect(messageText(logMessages[1])).toContain(
      "The bot needs the Manage Roles permission",
    );
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
                              secondaryColor: 0x0ea5e9,
                              tertiaryColor: 0xa855f7,
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
                color: 0x22c55e,
                colors: {
                  primary_color: 0x22c55e,
                  primary_hex: "#22C55E",
                  secondary_color: 0x0ea5e9,
                  secondary_hex: "#0EA5E9",
                  tertiary_color: 0xa855f7,
                  tertiary_hex: "#A855F7",
                },
                id: "template-role-id",
                usable_as_run_template: true,
              }) as unknown,
            ],
            settings: {
              bot_log_channel_id: "bot-log-channel-id",
              bot_moderator_role_id: "bot-moderator-role-id",
              linked_at: "2026-06-01T10:00:00.000Z",
              run_announcement_channel_id: "run-announcement-channel-id",
              run_role_template_overrides: [],
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
            scheduleRefreshEnabled: patch.scheduleRefreshEnabled ?? false,
            scheduleRefreshIntervalDays: patch.scheduleRefreshIntervalDays ?? 1,
            ...(patch.scheduleRefreshChannelId
              ? {
                  runAnnouncementChannelId: patch.scheduleRefreshChannelId,
                  scheduleRefreshChannelId: patch.scheduleRefreshChannelId,
                }
              : {}),
            syncDiscordNamesToFf14: patch.syncDiscordNamesToFf14 ?? false,
          };

          return Promise.resolve({
            ...settings,
            ...(patch.botModeratorRoleId
              ? { botModeratorRoleId: patch.botModeratorRoleId }
              : {}),
            ...(patch.runRoleTemplateOverrides
              ? { runRoleTemplateOverrides: patch.runRoleTemplateOverrides }
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
            run_role_template_overrides: [
              {
                activity_id: 321,
                activity_name: "Abyssos Savage",
                role_id: "abyssos-role-id",
              },
            ],
            run_role_template_id: "template-role-id",
            sync_discord_names_to_ff14: true,
            schedule_refresh_enabled: true,
            schedule_refresh_channel_id: "schedule-channel-id",
            schedule_refresh_interval_days: 7,
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
            run_role_template_overrides: [
              {
                activity_id: 321,
                activity_name: "Abyssos Savage",
                created_at: null,
                role_id: "abyssos-role-id",
                updated_at: null,
              },
            ],
            run_role_template_id: "template-role-id",
            sync_discord_names_to_ff14: true,
            upcoming_raider_role_id: "template-role-id",
            schedule_refresh_enabled: true,
            schedule_refresh_channel_id: "schedule-channel-id",
            schedule_refresh_interval_days: 7,
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
          runRoleTemplateOverrides: [
            {
              activityId: 321,
              activityName: "Abyssos Savage",
              roleId: "abyssos-role-id",
            },
          ],
          syncDiscordNamesToFf14: true,
          upcomingRaiderRoleId: "template-role-id",
          scheduleRefreshEnabled: true,
          scheduleRefreshChannelId: "schedule-channel-id",
          scheduleRefreshIntervalDays: 7,
        },
      },
    ]);
  });

  it("archives and unlinks guild data when FullParty disconnects a guild", async () => {
    const historyDirectory = join(
      process.cwd(),
      "history",
      "groups",
      "unlinked",
      "test-unlink",
    );
    const settingsUpdates: unknown[] = [];
    const obsoleteGuildIds: string[] = [];
    const context: BotContext = {
      ...createContext(),
      guildMemberCache: {
        getSnapshot: (
          discordGuildId: string,
          options?: { includeUserIds?: boolean | undefined },
        ) =>
          Promise.resolve({
            cacheAgeSeconds: 12,
            cachedMemberCount: 2,
            discordGuildId,
            ...(options?.includeUserIds ? { discordUserIds: ["111", "222"] } : {}),
            lastError: null,
            lastFullRefreshAt: "2026-08-01T10:00:00.000Z",
            memberCount: 3,
            nextRefreshAfter: "2026-08-02T10:00:00.000Z",
            refreshStatus: "fresh",
            stale: false,
            updatedAt: "2026-08-01T10:00:00.000Z",
          }),
        markGuildObsolete: (discordGuildId: string) => {
          obsoleteGuildIds.push(discordGuildId);
          return Promise.resolve();
        },
      } as never,
      guildRunRoles: {
        get: () => Promise.resolve(undefined),
        listByGuild: (discordGuildId: string) =>
          Promise.resolve([
            {
              createdAt: "2026-08-01T09:00:00.000Z",
              discordGuildId,
              roleId: "run-role-id",
              roleName: "FullParty: Run",
              runId: 123,
              status: "active",
              templateRoleId: "template-role-id",
              updatedAt: "2026-08-01T09:00:00.000Z",
            },
          ]),
        markDeleted: () => Promise.resolve(),
        upsert: (mapping) => Promise.resolve(mapping),
      },
      guildSettings: {
        get: (guildId) =>
          Promise.resolve({
            botLogChannelId: "bot-log-channel-id",
            guildId,
            linkedAt: "2026-08-01T09:30:00.000Z",
            runRoleTemplateOverrides: [
              {
                activityId: 321,
                activityName: "Abyssos Savage",
                roleId: "abyssos-role-id",
              },
            ],
            syncDiscordNamesToFf14: true,
            upcomingRaiderRoleId: "template-role-id",
          }),
        update: (guildId, patch) => {
          settingsUpdates.push({ guildId, patch });
          return Promise.resolve({
            guildId,
            syncDiscordNamesToFf14: true,
          });
        },
      },
    };
    const baseUrl = await listen(
      createTestServer({
        client: {
          guilds: {
            fetch: () => {
              throw new Error("Guild is unavailable.");
            },
          },
        } as never,
        context,
      }),
    );

    tempDirs.push(historyDirectory);

    await expect(
      postAction(baseUrl, {
        data: {
          disconnected_at: "2026-08-01T11:00:00+00:00",
          discord_guild_id: "guild-id",
          group_id: 45,
          group_name: "Test Unlink",
          group_slug: "test-unlink",
        },
        event: "discord.guild.disconnected",
      }),
    ).resolves.toMatchObject({
      body: {
        event: "discord.guild.disconnected",
        result: {
          archived: true,
          discordGuildId: "guild-id",
          groupId: 45,
          groupSlug: "test-unlink",
          unlinked: true,
        },
      },
      status: 200,
    });
    expect(settingsUpdates).toEqual([
      {
        guildId: "guild-id",
        patch: {
          groupSlug: null,
          linkedAt: null,
          scheduleMode: "disabled",
          scheduleRefreshEnabled: false,
          runRoleTemplateOverrides: [],
        },
      },
    ]);
    expect(obsoleteGuildIds).toEqual(["guild-id"]);

    const archive = JSON.parse(
      await readFile(join(historyDirectory, "data.json"), "utf8"),
    ) as Record<string, unknown>;

    expect(archive).toMatchObject({
      discord_guild_id: "guild-id",
      group_id: 45,
      group_slug: "test-unlink",
      local_data: {
        membership_cache: {
          discord_user_ids: ["111", "222"],
        },
        run_role_mappings: [
          {
            roleId: "run-role-id",
            runId: 123,
          },
        ],
        settings: {
          linked_at: "2026-08-01T09:30:00.000Z",
          run_role_template_overrides: [
            {
              activity_id: 321,
              activity_name: "Abyssos Savage",
              role_id: "abyssos-role-id",
            },
          ],
        },
      },
    });
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

function expectV2Message(message: unknown): void {
  expect(message).toMatchObject({
    flags: 32768,
    allowedMentions: { parse: [], repliedUser: false },
  });
  expect(message).not.toHaveProperty("content");
  expect(message).not.toHaveProperty("embeds");
}

function discordLoginEvent() {
  return {
    event: "user.discord_login",
    data: {
      user: { id: 123, name: "Example User" },
      discord_user_id: "234567890123456789",
      locale: "en",
      discord_app_install_url: "https://fullparty.gg/auth/discord-app/user/redirect",
      discord_app_installed: false,
    },
  };
}

type FetchTextResponse = {
  body: string;
  contentType: string | null;
  status: number;
};

function postAction(
  baseUrl: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<FetchJsonResponse> {
  const rawBody = JSON.stringify(body);
  const timestamp = currentTimestamp();

  return fetchJson(`${baseUrl}/events`, {
    ...(signal ? { signal } : {}),
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
    listByGuild: (discordGuildId) =>
      Promise.resolve(
        [...mappings.values()]
          .filter((mapping) => mapping.discordGuildId === discordGuildId)
          .sort((left, right) => left.runId - right.runId),
      ),
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
