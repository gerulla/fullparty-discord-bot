import { afterEach, describe, expect, it, vi } from "vitest";
import { createResourceListMessage } from "../src/fullparty/resources/listMessage.js";
import { resolveResourceListMetadata } from "../src/fullparty/resources/listMetadata.js";
import { FullpartyApiClient } from "../src/fullparty/client.js";
import type { ResourceListResponse } from "../src/fullparty/resources/schemas.js";
import { messageComponents, messageText } from "./helpers/messages.js";

function list(
  data: ResourceListResponse["data"] = [
    { command_name: "bridges", title: "Listed Title" },
  ],
): ResourceListResponse {
  return {
    data,
    components: [],
    meta: {
      group_id: 42,
      discord_guild_id: "123",
      current_page: 1,
      per_page: 8,
      total: data.length,
      last_page: 1,
      next_page: null,
    },
  };
}

function exact(commandName = "bridges") {
  return {
    found: true,
    data: {
      command_name: commandName,
      embed: {
        title: "Choose Your Bridge",
        author: { name: "DRS Preparation" },
        image: { url: "attachment://bridges.png" },
      },
      assets: [
        {
          id: "diagram",
          filename: "bridges.png",
          mime_type: "image/png",
          url: "https://fullparty.gg/bridges.png",
        },
      ],
      components: [],
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("resource list metadata", () => {
  it("uses exact embed title and author for legacy rows without fetching assets", async () => {
    const api = {
      getDiscordGuildResource: vi.fn().mockResolvedValue(exact("BRIDGES")),
      getDiscordGuildResourceAsset: vi.fn(),
    };
    const original = list();
    const result = await resolveResourceListMetadata(api, "123", original);

    expect(api.getDiscordGuildResource.mock.calls[0]?.slice(0, 4)).toEqual([
      "123",
      "bridges",
      1,
      8,
    ]);
    expect(api.getDiscordGuildResource.mock.calls[0]?.[4]).toHaveProperty("signal");
    expect(api.getDiscordGuildResourceAsset).not.toHaveBeenCalled();
    expect(result.data[0]?.embed).toEqual({
      title: "Choose Your Bridge",
      author: { name: "DRS Preparation" },
    });
    expect(original.data[0]?.embed).toBeUndefined();
    expect(messageText(createResourceListMessage(result, "session"))).toContain(
      "**/info bridges** - Choose Your Bridge\n-# DRS Preparation",
    );
    expect(result.meta).toEqual(original.meta);
    expect(result.components).toEqual(original.components);
  });

  it("trusts supplied nested or flat summaries, including explicitly absent metadata", async () => {
    const api = { getDiscordGuildResource: vi.fn() };
    const original = list([
      {
        command_name: "nested",
        title: "Listed Title",
        embed: { title: "Embed Title", author: { name: "Resource Title" } },
      },
      { command_name: "no-embed", title: "Listed Title", embed: null },
      { command_name: "flat", title: "Resource Title", embed_title: "Embed Title" },
      { command_name: "no-title", title: "Resource Title", embed_title: null },
      {
        command_name: "current",
        title: "Embed Title",
        embed_title: "Embed Title",
        resource_title: "Resource Title",
      },
      { command_name: "alias", title: "Embed Title", resource_title: "Resource Title" },
      { command_name: "no-resource-title", title: "Embed Title", resource_title: null },
    ]);

    expect(await resolveResourceListMetadata(api, "123", original)).toEqual(original);
    expect(api.getDiscordGuildResource).not.toHaveBeenCalled();
  });

  it("limits concurrent metadata requests to four and coalesces overlapping pages", async () => {
    const pending: { name: string; resolve: (value: unknown) => void }[] = [];
    let active = 0;
    let peak = 0;
    const api = {
      getDiscordGuildResource: vi.fn(async (_guildId: string, name: string) => {
        active += 1;
        peak = Math.max(peak, active);
        try {
          return await new Promise<unknown>((resolve) => pending.push({ name, resolve }));
        } finally {
          active -= 1;
        }
      }),
    };
    const original = list(
      Array.from({ length: 8 }, (_, index) => ({
        command_name: `resource-${String(index)}`,
        title: "Listed Title",
      })),
    );
    const first = resolveResourceListMetadata(api, "123", original);
    const duplicate = resolveResourceListMetadata(api, "123", original);
    expect(pending).toHaveLength(4);
    pending.slice(0, 4).forEach(({ name, resolve }) => {
      resolve(exact(name));
    });
    await vi.waitFor(() => {
      expect(pending).toHaveLength(8);
    });
    pending.slice(4).forEach(({ name, resolve }) => {
      resolve(exact(name));
    });
    const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);

    expect(peak).toBe(4);
    expect(api.getDiscordGuildResource).toHaveBeenCalledTimes(8);
    expect(firstResult).toEqual(duplicateResult);
    expect(
      firstResult.data.every((item) => item.embed?.author?.name === "DRS Preparation"),
    ).toBe(true);
  });

  it("isolates cached metadata by API client, guild, command and listed title", async () => {
    const getDiscordGuildResource = vi.fn((_guildId: string, name: string) =>
      Promise.resolve(exact(name)),
    );
    const api = { getDiscordGuildResource };
    await resolveResourceListMetadata(api, "123", list());
    await resolveResourceListMetadata(api, "123", list());
    expect(getDiscordGuildResource).toHaveBeenCalledTimes(1);

    await resolveResourceListMetadata(api, "456", list());
    await resolveResourceListMetadata(
      api,
      "123",
      list([{ command_name: "bridges", title: "Renamed Title" }]),
    );
    await resolveResourceListMetadata(
      api,
      "123",
      list([{ command_name: "positions", title: "Listed Title" }]),
    );
    await resolveResourceListMetadata({ getDiscordGuildResource }, "123", list());
    expect(getDiscordGuildResource).toHaveBeenCalledTimes(5);
  });

  it("shares four request slots across different guilds and drops excess optional work", async () => {
    const pending: { name: string; resolve: (value: unknown) => void }[] = [];
    const api = {
      getDiscordGuildResource: vi.fn(
        (_guildId: string, name: string) =>
          new Promise<unknown>((resolve) => pending.push({ name, resolve })),
      ),
    };
    const original = list(
      Array.from({ length: 8 }, (_, index) => ({
        command_name: `resource-${String(index)}`,
      })),
    );
    const first = resolveResourceListMetadata(api, "123", original);
    const excess = await Promise.all(
      ["456", "789", "012", "345"].map((guildId) =>
        resolveResourceListMetadata(api, guildId, original),
      ),
    );
    expect(pending).toHaveLength(4);
    expect(excess).toEqual(Array.from({ length: 4 }, () => original));
    pending.slice(0, 4).forEach(({ name, resolve }) => {
      resolve(exact(name));
    });
    await vi.waitFor(() => {
      expect(pending).toHaveLength(8);
    });
    pending.slice(4).forEach(({ name, resolve }) => {
      resolve(exact(name));
    });
    await first;
    expect(api.getDiscordGuildResource).toHaveBeenCalledTimes(8);
  });

  it("aborts real client requests after one second and leaves the list usable", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn<typeof fetch>((_url, init) => {
      const signal = init?.signal;
      if (!signal) throw new Error("Expected cancellation signal");
      signals.push(signal);
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            reject(new Error("Aborted"));
          },
          {
            once: true,
          },
        );
      });
    });
    const api = new FullpartyApiClient({ baseUrl: "https://fullparty.gg/api", fetcher });
    const original = list(
      Array.from({ length: 8 }, (_, index) => ({
        command_name: `resource-${String(index)}`,
      })),
    );
    const first = resolveResourceListMetadata(api, "123", original);
    expect(fetcher).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await first).toEqual(original);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(4);

    fetcher.mockResolvedValue(Response.json(exact("healthy")));
    const next = await resolveResourceListMetadata(
      api,
      "456",
      list([{ command_name: "healthy" }]),
    );
    expect(next.data[0]?.embed?.author?.name).toBe("DRS Preparation");
  });

  it("bounds page latency even if a custom transport ignores cancellation", async () => {
    vi.useFakeTimers();
    const api = {
      getDiscordGuildResource: vi.fn(
        () =>
          new Promise<unknown>(() => {
            // Deliberately stalled transport that ignores cancellation.
          }),
      ),
    };
    const original = list();
    const first = resolveResourceListMetadata(api, "123", original);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await first).toEqual(original);
    // Coalescing remains bounded: no new request for the same stuck lookup.
    const repeated = resolveResourceListMetadata(api, "123", original);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await repeated).toEqual(original);
    expect(api.getDiscordGuildResource).toHaveBeenCalledTimes(1);
  });

  it("refreshes successful metadata after five minutes", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const api = { getDiscordGuildResource: vi.fn().mockResolvedValue(exact()) };
    await resolveResourceListMetadata(api, "123", list());
    clock.mockReturnValue(1_299_999);
    await resolveResourceListMetadata(api, "123", list());
    expect(api.getDiscordGuildResource).toHaveBeenCalledTimes(1);

    clock.mockReturnValue(1_300_000);
    await resolveResourceListMetadata(api, "123", list());
    expect(api.getDiscordGuildResource).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["network failure", () => Promise.reject(new Error("Offline"))],
    ["invalid response", () => Promise.resolve({ found: true, data: {} })],
    ["non-exact response", () => Promise.resolve({ found: false, ...list() })],
    ["different resource", () => Promise.resolve(exact("loadouts"))],
  ])(
    "keeps the list usable after %s and briefly caches failures",
    async (_label, fail) => {
      const clock = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
      const api = {
        getDiscordGuildResource: vi
          .fn()
          .mockImplementationOnce(fail)
          .mockResolvedValue(exact()),
      };
      const original = list();
      const fallback = await resolveResourceListMetadata(api, "123", original);
      expect(fallback).toEqual(original);
      const message = createResourceListMessage(fallback, "session");
      expect(messageText(message)).toContain("**/info bridges** - Listed Title");
      expect(messageComponents(message)).toContainEqual(
        expect.objectContaining({ label: "Show", custom_id: "info:show:session:1:0" }),
      );

      expect(await resolveResourceListMetadata(api, "123", original)).toEqual(original);
      expect(api.getDiscordGuildResource).toHaveBeenCalledTimes(1);
      clock.mockReturnValue(1_030_000);
      const retried = await resolveResourceListMetadata(api, "123", original);
      expect(retried.data[0]?.embed?.author?.name).toBe("DRS Preparation");
      expect(api.getDiscordGuildResource).toHaveBeenCalledTimes(2);
    },
  );
});
