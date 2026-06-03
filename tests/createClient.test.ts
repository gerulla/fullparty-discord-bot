import { Client, Events, type Guild, type GuildMember } from "discord.js";
import { describe, expect, it } from "vitest";

import type { BotContext } from "../src/bot/context.js";
import { createBotClient } from "../src/bot/createClient.js";
import { FullpartyApiClient } from "../src/fullparty/client.js";
import { LatestPayloadStore } from "../src/payloads/latestPayloadStore.js";

describe("createBotClient", () => {
  it("registers Discord lifecycle and interaction listeners", () => {
    const context = createContext();
    const client = createBotClient(context);

    expect(client.listenerCount(Events.ClientReady)).toBe(1);
    expect(client.listenerCount(Events.GuildCreate)).toBe(1);
    expect(client.listenerCount(Events.GuildDelete)).toBe(1);
    expect(client.listenerCount(Events.GuildMemberAdd)).toBe(1);
    expect(client.listenerCount(Events.GuildMemberRemove)).toBe(1);
    expect(client.listenerCount(Events.InteractionCreate)).toBe(1);
    expect(client.listenerCount(Events.MessageCreate)).toBe(1);

    client.emit(Events.ClientReady, {
      application: { id: "application-id" },
      user: { tag: "Fullparty#0001" },
    } as unknown as Client<true>);

    expect(context.logCalls).toEqual([["info", "Discord client is ready."]]);

    void client.destroy();
  });

  it("keeps the guild member cache updated from Discord member events", () => {
    const context = createContext();
    const client = createBotClient(context);

    client.emit(Events.GuildMemberAdd, {
      guild: { id: "guild-id" },
      id: "bot-user-id",
      user: { bot: true },
    } as unknown as GuildMember);
    client.emit(Events.GuildMemberAdd, {
      guild: { id: "guild-id" },
      id: "user-id",
      user: { bot: false },
    } as unknown as GuildMember);
    client.emit(Events.GuildMemberRemove, {
      guild: { id: "guild-id" },
      id: "user-id",
    } as unknown as GuildMember);
    client.emit(Events.GuildCreate, {
      id: "guild-id",
    } as unknown as Guild);
    client.emit(Events.GuildDelete, {
      id: "guild-id",
    } as unknown as Guild);

    expect(context.memberCacheCalls).toEqual([
      ["seen", "guild-id", "user-id"],
      ["removed", "guild-id", "user-id"],
      ["obsolete", "guild-id"],
    ]);
    expect(context.schedulerCalls).toEqual([["refresh", "guild-id", "guild_joined"]]);

    void client.destroy();
  });

  it("sends the admin API token to the configured owner in DMs", async () => {
    const context = createContext();
    const client = createBotClient(context);
    const replies: unknown[] = [];

    context.adminApiToken = "admin-api-token";
    context.payloadCommandAllowedUserId = "owner-user-id";
    client.emit(
      Events.MessageCreate as never,
      {
        author: {
          bot: false,
          id: "owner-user-id",
        },
        content: "!token",
        inGuild: () => false,
        reply: (message: unknown) => {
          replies.push(message);

          return Promise.resolve({});
        },
      } as never,
    );
    await flushPromises();

    expect(replies).toEqual([
      {
        content:
          "Here is your FullParty bot admin API token:\n\n```\nadmin-api-token\n```\n\nUse it on the admin dashboard login page. Treat it like a password.",
      },
    ]);

    void client.destroy();
  });

  it("does not send the admin API token outside owner DMs", async () => {
    const context = createContext();
    const client = createBotClient(context);
    const replies: unknown[] = [];

    context.adminApiToken = "admin-api-token";
    context.payloadCommandAllowedUserId = "owner-user-id";
    client.emit(
      Events.MessageCreate as never,
      {
        author: {
          bot: false,
          id: "owner-user-id",
        },
        content: "!token",
        inGuild: () => true,
        reply: (message: unknown) => {
          replies.push(message);

          return Promise.resolve({});
        },
      } as never,
    );
    client.emit(
      Events.MessageCreate as never,
      {
        author: {
          bot: false,
          id: "different-user-id",
        },
        content: "!token",
        inGuild: () => false,
        reply: (message: unknown) => {
          replies.push(message);

          return Promise.resolve({});
        },
      } as never,
    );
    await flushPromises();

    expect(replies).toEqual([
      "This admin token is only available to the configured owner.",
    ]);

    void client.destroy();
  });
});

type TestContext = BotContext & {
  logCalls: string[][];
  memberCacheCalls: string[][];
  schedulerCalls: string[][];
};

function createContext(): TestContext {
  const logCalls: string[][] = [];
  const memberCacheCalls: string[][] = [];
  const schedulerCalls: string[][] = [];

  return {
    fullparty: new FullpartyApiClient({
      baseUrl: "https://api.fullparty.gg",
      fetcher: () => Promise.resolve(new Response(null, { status: 204 })),
    }),
    fullpartyWebBaseUrl: "https://fullparty.gg",
    guildMemberCache: {
      deleteGuild: (guildId: string) => {
        memberCacheCalls.push(["deleteGuild", guildId]);

        return Promise.resolve();
      },
      markGuildObsolete: (guildId: string) => {
        memberCacheCalls.push(["obsolete", guildId]);

        return Promise.resolve();
      },
      markMemberRemoved: (guildId: string, userId: string) => {
        memberCacheCalls.push(["removed", guildId, userId]);

        return Promise.resolve();
      },
      markMemberSeen: (guildId: string, userId: string) => {
        memberCacheCalls.push(["seen", guildId, userId]);

        return Promise.resolve();
      },
    } as never,
    guildMemberCacheScheduler: {
      enqueueRefresh: (guildId: string, reason: string) => {
        schedulerCalls.push(["refresh", guildId, reason]);

        return Promise.resolve({
          alreadyQueued: false,
          discordGuildId: guildId,
          queued: true,
          reason,
        });
      },
    } as never,
    guildSettings: {
      get: (guildId) => Promise.resolve({ guildId, syncDiscordNamesToFf14: false }),
      update: (guildId) => Promise.resolve({ guildId, syncDiscordNamesToFf14: false }),
    },
    logCalls,
    logger: {
      debug: (message) => {
        logCalls.push(["debug", message]);
      },
      error: (message) => {
        logCalls.push(["error", message]);
      },
      info: (message) => {
        logCalls.push(["info", message]);
      },
      warn: (message) => {
        logCalls.push(["warn", message]);
      },
    },
    memberCacheCalls,
    payloads: new LatestPayloadStore(),
    schedulerCalls,
  };
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}
