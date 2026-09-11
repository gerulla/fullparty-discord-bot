import { EmbedBuilder } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { FullpartyApiClient } from "../src/fullparty/client.js";
import { createResourceMessage } from "../src/fullparty/resources/messages.js";
import { createResourceListMessage } from "../src/fullparty/resources/listMessage.js";
import {
  resourceResponseSchema,
  resourceListResponseSchema,
  resourceLookupResponseSchema,
} from "../src/fullparty/resources/schemas.js";
import { GuildResourceService } from "../src/fullparty/resources/service.js";
import { fetchUrl, fetchJsonBody } from "./helpers/http.js";

function listResponse(page: number, nextPage: number | null) {
  return {
    data:
      page === 1
        ? [
            { command_name: "bridges", title: "DRS Bridge Positions" },
            { command_name: "loadouts", title: "Recommended Loadouts" },
          ]
        : [{ command_name: "positions", title: null }],
    meta: {
      group_id: 42,
      discord_guild_id: "123",
      current_page: page,
      per_page: 2,
      total: 3,
      last_page: 2,
      next_page: nextPage,
    },
  };
}

describe("FullParty guild resources", () => {
  it("distinguishes exact resources, search pages, empty results and malformed discriminators", () => {
    const results = { found: false, ...listResponse(1, null) };
    expect(resourceLookupResponseSchema.parse(results).found).toBe(false);
    expect(
      resourceLookupResponseSchema.safeParse({ ...results, found: true }).success,
    ).toBe(false);
    expect(resourceLookupResponseSchema.safeParse(listResponse(1, null)).success).toBe(
      false,
    );
    expect(
      resourceLookupResponseSchema.parse({
        ...results,
        data: [],
        meta: { ...results.meta, total: 0, last_page: 1 },
      }),
    ).toMatchObject({ found: false, data: [], components: [] });
  });

  it("keeps long names and titles within the embed limit without dropping page entries", () => {
    const page = listResponse(1, null);
    const message = createResourceListMessage(
      {
        ...page,
        components: [],
        data: Array.from({ length: 10 }, () => ({
          command_name: "*".repeat(100),
          title: "*".repeat(256),
        })),
        meta: { ...page.meta, per_page: 10, total: 10, last_page: 1 },
      },
      "session",
      "*".repeat(100),
    );
    const embed = message.embeds?.[0];
    if (!(embed instanceof EmbedBuilder)) throw new Error("Expected embed");
    expect(embed.data.description?.length).toBeLessThanOrEqual(4096);
    expect(embed.data.description?.match(/\/info name:/gu)).toHaveLength(10);
    expect(embed.data.description).toContain("...");
  });

  it("validates list link buttons and leaves room for navigation", () => {
    const page = listResponse(1, null);
    const row = {
      type: 1,
      components: [
        {
          type: 2,
          style: 5,
          label: "Open Resources",
          url: "https://resources.fullparty.gg/group",
        },
      ],
    };
    const valid = resourceListResponseSchema.parse({
      ...page,
      components: Array.from({ length: 4 }, () => row),
    });
    expect(createResourceListMessage(valid, "session").components).toHaveLength(5);
    expect(
      resourceListResponseSchema.safeParse({
        ...page,
        components: Array.from({ length: 5 }, () => row),
      }).success,
    ).toBe(false);
    expect(
      resourceListResponseSchema.safeParse({
        ...page,
        components: [
          { type: 1, components: [{ ...row.components[0], url: "javascript:alert(1)" }] },
        ],
      }).success,
    ).toBe(false);
  });

  it("POSTs authenticated list requests one page at a time", async () => {
    const bodies: unknown[] = [];
    const fetcher = vi.fn<typeof fetch>((url, init) => {
      expect(fetchUrl(url)).toBe("https://fullparty.gg/api/integrations/resources/list");
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer integration-token");
      expect(headers.get("accept")).toBe("application/json");
      expect(headers.get("content-type")).toBe("application/json");
      bodies.push(fetchJsonBody(init));
      return Promise.resolve(
        Response.json(listResponse(bodies.length, bodies.length === 1 ? 2 : null)),
      );
    });
    const service = new GuildResourceService(
      new FullpartyApiClient({
        baseUrl: "https://fullparty.gg/api",
        apiToken: "integration-token",
        fetcher,
      }),
    );
    await expect(service.list("123")).resolves.toEqual({
      ...listResponse(1, 2),
      components: [],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(service.list("123", 2)).resolves.toEqual({
      ...listResponse(2, null),
      components: [],
    });
    expect(bodies).toEqual([
      { discord_guild_id: "123", page: 1, per_page: 10 },
      { discord_guild_id: "123", page: 2, per_page: 10 },
    ]);
  });

  it("fetches an encoded resource name without changing it or dropping guild context", async () => {
    const fetcher = vi.fn<typeof fetch>((url, init) => {
      expect(fetchUrl(url)).toBe(
        "https://fullparty.gg/api/integrations/resources/Bridge%20%26%20Positions",
      );
      expect(init?.method).toBe("POST");
      expect(fetchJsonBody(init)).toEqual({
        discord_guild_id: "123",
        page: 1,
        per_page: 10,
      });
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer integration-token",
      );
      return Promise.resolve(
        Response.json({
          found: true,
          data: {
            command_name: "Bridge & Positions",
            embed: { title: "Positions" },
            assets: [],
            components: [],
          },
        }),
      );
    });
    const service = new GuildResourceService(
      new FullpartyApiClient({
        baseUrl: "https://fullparty.gg/api",
        apiToken: "integration-token",
        fetcher,
      }),
    );
    await expect(service.lookup("123", "Bridge & Positions")).resolves.toMatchObject({
      found: true,
      data: { command_name: "Bridge & Positions" },
    });
  });

  it.each([1, 3])("rejects looping or invalid pagination (%s)", async (next) => {
    const service = new GuildResourceService({
      listDiscordGuildResources: () => Promise.resolve(listResponse(1, next)),
      getDiscordGuildResource: () => Promise.resolve({}),
      getDiscordGuildResourceAsset: () => Promise.resolve(Buffer.alloc(0)),
    });
    await expect(service.list("123")).rejects.toMatchObject({
      code: "invalid_resource_response",
    });
  });

  it("rejects resources for the wrong guild", async () => {
    const service = new GuildResourceService({
      listDiscordGuildResources: () => Promise.resolve(listResponse(1, null)),
      getDiscordGuildResource: () => Promise.resolve({}),
      getDiscordGuildResourceAsset: () => Promise.resolve(Buffer.alloc(0)),
    });
    await expect(service.list("different-guild")).rejects.toMatchObject({
      code: "invalid_resource_response",
    });
  });

  it.each([401, 403, 404, 429, 503])(
    "reports HTTP %s with a safe user-facing error",
    async (status) => {
      const service = new GuildResourceService(
        new FullpartyApiClient({
          baseUrl: "https://fullparty.gg/api",
          fetcher: () =>
            Promise.resolve(
              Response.json({ message: "internal diagnostic" }, { status }),
            ),
        }),
      );
      await expect(service.lookup("123", "bridges")).rejects.toMatchObject({
        code: `fullparty_api_${String(status)}`,
        affectsHealth: status >= 500,
      });
      await expect(service.lookup("123", "bridges")).rejects.not.toThrow(
        "internal diagnostic",
      );
    },
  );

  it("converts standard Discord embed fields and preserves authored formatting", () => {
    const payload = resourceResponseSchema.parse({
      found: true,
      data: {
        command_name: "bridges",
        embed: {
          title: "DRS Bridge Positions",
          description: "**Check** your assigned bridge.",
          color: 0,
          url: "https://fullparty.gg/resources/bridges",
          timestamp: "2026-09-10T12:00:00+00:00",
          footer: { text: "FullParty", icon_url: "https://fullparty.gg/icon.png" },
          author: {
            name: "Raid Leader",
            url: "https://fullparty.gg",
            icon_url: "https://fullparty.gg/avatar.png",
          },
          thumbnail: { url: "https://fullparty.gg/thumbnail.png" },
          image: { url: "https://fullparty.gg/bridge.png" },
          fields: [{ name: "West", value: "Party A", inline: true }],
        },
        assets: [],
        components: [],
      },
    }).data;
    const message = createResourceMessage(payload);
    const embed = message.embeds?.[0];
    if (!(embed instanceof EmbedBuilder)) throw new Error("Expected an embed builder");
    expect(embed.toJSON()).toEqual({
      ...payload.embed,
      timestamp: "2026-09-10T12:00:00.000Z",
    });
    expect(message.allowedMentions).toEqual({ parse: [], repliedUser: false });
  });

  it("rejects malformed or excessive embeds before sending to Discord", () => {
    expect(() =>
      resourceResponseSchema.parse({
        found: true,
        data: {
          command_name: "bad",
          embed: { title: "x".repeat(257) },
          assets: [],
          components: [],
        },
      }),
    ).toThrow();
    expect(() =>
      createResourceMessage({
        command_name: "bad",
        embed: {
          description: "x".repeat(4096),
          fields: [
            { name: "A", value: "x".repeat(1024) },
            { name: "B", value: "x".repeat(1024) },
          ],
        },
        assets: [],
        components: [],
      }),
    ).toThrow("cannot display");
    expect(() =>
      createResourceMessage({
        command_name: "bad",
        embed: {},
        assets: [],
        components: [],
      }),
    ).toThrow("cannot display");
  });

  it("renders the server's current page with distinct button IDs", () => {
    const message = createResourceListMessage(
      { ...listResponse(2, null), components: [] },
      "session-id",
    );
    const embed = message.embeds?.[0];
    if (!(embed instanceof EmbedBuilder)) throw new Error("Expected an embed builder");
    expect(message.embeds).toHaveLength(1);
    expect(embed.data.description).toContain("Untitled resource");
    expect(embed.data.footer?.text).toBe("3 resources | Page 2/2");
    expect(JSON.stringify(message.components)).toContain("info:previous:session-id:1");
    expect(JSON.stringify(message.components)).toContain("info:next:session-id:2");
  });

  it("uses distinct disabled controls on a single page and does not invent public links", () => {
    const result = listResponse(1, null);
    const message = createResourceListMessage(
      { ...result, meta: { ...result.meta, last_page: 1 }, components: [] },
      "session-id",
    );
    expect(message.components).toHaveLength(1);
    const controls = JSON.parse(JSON.stringify(message.components)) as {
      components: { custom_id: string; disabled: boolean }[];
    }[];
    const buttons = controls[0]?.components ?? [];
    expect(buttons.map((button) => button.custom_id)).toEqual([
      "info:previous:session-id:1",
      "info:next:session-id:1",
    ]);
    expect(buttons.every((button) => button.disabled)).toBe(true);
  });
});
