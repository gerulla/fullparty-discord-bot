import { Client, Events } from "discord.js";
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
    expect(client.listenerCount(Events.InteractionCreate)).toBe(1);

    client.emit(Events.ClientReady, {
      application: { id: "application-id" },
      user: { tag: "Fullparty#0001" },
    } as unknown as Client<true>);

    expect(context.logCalls).toEqual([["info", "Discord client is ready."]]);

    void client.destroy();
  });
});

type TestContext = BotContext & {
  logCalls: string[][];
};

function createContext(): TestContext {
  const logCalls: string[][] = [];

  return {
    fullparty: new FullpartyApiClient({
      baseUrl: "https://api.fullparty.gg",
      fetcher: () => Promise.resolve(new Response(null, { status: 204 })),
    }),
    fullpartyWebBaseUrl: "https://fullparty.gg",
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
    payloads: new LatestPayloadStore(),
  };
}
