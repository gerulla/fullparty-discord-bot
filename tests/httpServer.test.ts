import { once } from "node:events";
import { createHmac } from "node:crypto";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import type { BotContext } from "../src/bot/context.js";
import {
  createWebhookServer,
  stopWebhookServer,
  type WebhookServerOptions,
} from "../src/http/server.js";
import { LatestPayloadStore } from "../src/payloads/latestPayloadStore.js";

describe("Fullparty webhook server", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => stopWebhookServer(server)));
  });

  it("reports health without authentication", async () => {
    const baseUrl = await listen(createTestServer());

    await expect(fetchJson(`${baseUrl}/health`)).resolves.toMatchObject({
      body: {
        ok: true,
        status: "healthy",
      },
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
          "Welcome to FullParty. Your Discord account is now connected.\n\nThis integration lets FullParty keep your Discord identity in sync with your account, unlock Discord-powered account features, and send you useful updates when something needs your attention.\n\nYou can disconnect this anytime from your FullParty account settings.",
      },
    ]);
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
      client: { channels: { fetch: () => Promise.resolve(null) } } as never,
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

function currentTimestamp(): string {
  return String(Math.floor(Date.now() / 1000));
}

function signBody(timestamp: string, rawBody: string): string {
  const digest = createHmac("sha256", "secret")
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  return `sha256=${digest}`;
}
