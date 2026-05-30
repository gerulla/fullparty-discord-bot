import { describe, expect, it } from "vitest";

import { FullpartyApiClient, FullpartyApiError } from "../src/fullparty/client.js";

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];
type FetchCall = {
  init?: FetchInit;
  input: FetchInput;
};

describe("FullpartyApiClient", () => {
  it("requests health from the configured API base URL", async () => {
    const calls: FetchCall[] = [];
    const fetcher: typeof fetch = (input, init) => {
      const call: FetchCall = init === undefined ? { input } : { input, init };
      calls.push(call);

      return Promise.resolve(
        new Response(JSON.stringify({ status: "ok", version: "1.0.0" }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );
    };

    const client = new FullpartyApiClient({
      apiToken: "api-token",
      baseUrl: "https://api.fullparty.gg/v1",
      fetcher,
    });

    await expect(client.health()).resolves.toEqual({
      status: "ok",
      version: "1.0.0",
    });

    const call = calls.at(0);

    expect(call).toBeDefined();

    if (!call) {
      throw new Error("Expected fetch to be called.");
    }

    expect(fetchInputToUrl(call.input)).toBe("https://api.fullparty.gg/v1/health");

    const headers = new Headers(call.init?.headers);

    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("authorization")).toBe("Bearer api-token");
  });

  it("throws a typed error for failed API responses", async () => {
    const fetcher: typeof fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "maintenance" }), {
          headers: { "content-type": "application/json" },
          status: 503,
        }),
      );

    const client = new FullpartyApiClient({
      baseUrl: "https://api.fullparty.gg",
      fetcher,
    });

    await expect(client.health()).rejects.toMatchObject({
      body: { error: "maintenance" },
      name: "FullpartyApiError",
      status: 503,
    } satisfies Partial<FullpartyApiError>);
  });

  it("requests Discord user applications", async () => {
    const calls: FetchCall[] = [];
    const fetcher: typeof fetch = (input, init) => {
      const call: FetchCall = init === undefined ? { input } : { input, init };
      calls.push(call);

      return Promise.resolve(
        new Response(JSON.stringify({ data: [] }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );
    };
    const client = new FullpartyApiClient({
      apiToken: "api-token",
      baseUrl: "http://fullparty.test/api",
      fetcher,
    });

    await expect(
      client.getDiscordUserApplications("182520880277094400"),
    ).resolves.toEqual({
      data: [],
    });

    const call = calls.at(0);

    expect(call).toBeDefined();

    if (!call) {
      throw new Error("Expected fetch to be called.");
    }

    expect(fetchInputToUrl(call.input)).toBe(
      "http://fullparty.test/api/integrations/discord-users/182520880277094400/applications",
    );
  });

  it("requests Discord user upcoming runs", async () => {
    const calls: FetchCall[] = [];
    const fetcher: typeof fetch = (input, init) => {
      const call: FetchCall = init === undefined ? { input } : { input, init };
      calls.push(call);

      return Promise.resolve(
        new Response(JSON.stringify({ data: [] }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );
    };
    const client = new FullpartyApiClient({
      baseUrl: "http://fullparty.test/api",
      fetcher,
    });

    await expect(
      client.getDiscordUserUpcomingRuns("182520880277094400"),
    ).resolves.toEqual({
      data: [],
    });

    const call = calls.at(0);

    expect(call).toBeDefined();

    if (!call) {
      throw new Error("Expected fetch to be called.");
    }

    expect(fetchInputToUrl(call.input)).toBe(
      "http://fullparty.test/api/integrations/discord-users/182520880277094400/upcoming-runs",
    );
  });

  it("links a Discord user with the integration token payload", async () => {
    const calls: FetchCall[] = [];
    const fetcher: typeof fetch = (input, init) => {
      const call: FetchCall = init === undefined ? { input } : { input, init };
      calls.push(call);

      return Promise.resolve(
        new Response(JSON.stringify({ linked: true }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );
    };
    const client = new FullpartyApiClient({
      apiToken: "api-token",
      baseUrl: "http://fullparty.test/api",
      fetcher,
    });

    await expect(
      client.linkDiscordUser({
        avatarUrl: "https://cdn.discordapp.com/avatar.png",
        discordUserId: "182520880277094400",
        globalName: "Giki",
        token: "ABCD1234-EFGH5678",
        username: "yenpress",
      }),
    ).resolves.toEqual({
      linked: true,
    });

    const call = calls.at(0);

    expect(call).toBeDefined();

    if (!call) {
      throw new Error("Expected fetch to be called.");
    }

    expect(fetchInputToUrl(call.input)).toBe(
      "http://fullparty.test/api/integrations/discord-users/link",
    );
    expect(call.init?.method).toBe("POST");

    const headers = new Headers(call.init?.headers);

    expect(headers.get("authorization")).toBe("Bearer api-token");
    expect(headers.get("content-type")).toBe("application/json");
    expect(parseJsonRequestBody(call)).toEqual({
      avatar_url: "https://cdn.discordapp.com/avatar.png",
      discord_user_id: "182520880277094400",
      global_name: "Giki",
      token: "ABCD1234-EFGH5678",
      username: "yenpress",
    });
  });

  it("links a Discord guild with the integration token payload", async () => {
    const calls: FetchCall[] = [];
    const fetcher: typeof fetch = (input, init) => {
      const call: FetchCall = init === undefined ? { input } : { input, init };
      calls.push(call);

      return Promise.resolve(
        new Response(JSON.stringify({ linked: true }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );
    };
    const client = new FullpartyApiClient({
      apiToken: "api-token",
      baseUrl: "http://fullparty.test/api",
      fetcher,
    });

    await expect(
      client.linkDiscordGuild({
        discordGuildId: "1379217636696789022",
        iconUrl: "https://cdn.discordapp.com/icons/server.png",
        name: "Raid Server",
        permissions: "123456",
        token: "ABCD1234-EFGH5678",
      }),
    ).resolves.toEqual({
      linked: true,
    });

    const call = calls.at(0);

    expect(call).toBeDefined();

    if (!call) {
      throw new Error("Expected fetch to be called.");
    }

    expect(fetchInputToUrl(call.input)).toBe(
      "http://fullparty.test/api/integrations/discord-guilds/link",
    );
    expect(call.init?.method).toBe("POST");

    const headers = new Headers(call.init?.headers);

    expect(headers.get("authorization")).toBe("Bearer api-token");
    expect(headers.get("content-type")).toBe("application/json");
    expect(parseJsonRequestBody(call)).toEqual({
      discord_guild_id: "1379217636696789022",
      icon_url: "https://cdn.discordapp.com/icons/server.png",
      name: "Raid Server",
      permissions: "123456",
      token: "ABCD1234-EFGH5678",
    });
  });

  it("reads plain text error bodies", async () => {
    const fetcher: typeof fetch = () =>
      Promise.resolve(
        new Response("maintenance", {
          headers: { "content-type": "text/plain" },
          status: 503,
        }),
      );

    const client = new FullpartyApiClient({
      baseUrl: "https://api.fullparty.gg",
      fetcher,
    });

    await expect(client.health()).rejects.toMatchObject({
      body: "maintenance",
      status: 503,
    } satisfies Partial<FullpartyApiError>);
  });

  it("rejects unexpected successful non-json responses", async () => {
    const fetcher: typeof fetch = () =>
      Promise.resolve(
        new Response("ok", {
          headers: { "content-type": "text/plain" },
          status: 200,
        }),
      );

    const client = new FullpartyApiClient({
      baseUrl: "https://api.fullparty.gg",
      fetcher,
    });

    await expect(client.health()).rejects.toThrow(/Expected JSON/u);
  });

  it("allows no-content responses", async () => {
    const fetcher: typeof fetch = () =>
      Promise.resolve(
        new Response(null, {
          status: 204,
        }),
      );

    const client = new FullpartyApiClient({
      baseUrl: "https://api.fullparty.gg",
      fetcher,
    });

    await expect(client.health()).resolves.toBeUndefined();
  });
});

function fetchInputToUrl(input: FetchInput): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.href;
  }

  return input.url;
}

function parseJsonRequestBody(call: FetchCall): unknown {
  const body = call.init?.body;

  if (typeof body !== "string") {
    throw new Error("Expected request body to be a string.");
  }

  return JSON.parse(body) as unknown;
}
