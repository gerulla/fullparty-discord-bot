import { ComponentType, ContainerBuilder, EmbedBuilder, MessageFlags } from "discord.js";
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
import { messageComponents, messageText } from "./helpers/messages.js";

function listResponse(page: number, nextPage: number | null) {
  return {
    data:
      page === 1
        ? [
            {
              command_name: "bridges",
              title: "DRS Bridge Positions",
              embed: {
                title: "Choose Your Bridge",
                author: { name: "DRS Bridge Positions" },
              },
            },
            {
              command_name: "loadouts",
              embed: {
                title: "Recommended Loadouts",
                author: { name: "Raid Preparation" },
              },
            },
          ]
        : [{ command_name: "positions", title: null, embed: {} }],
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

  it("keeps eight long resource rows within V2 limits without dropping entries", () => {
    const page = listResponse(1, null);
    const message = createResourceListMessage(
      {
        ...page,
        components: [],
        data: Array.from({ length: 8 }, () => ({
          command_name: "*".repeat(100),
          title: "*".repeat(256),
          embed: {
            title: "*".repeat(256),
            author: { name: "*".repeat(256) },
          },
        })),
        meta: { ...page.meta, per_page: 8, total: 8, last_page: 1 },
      },
      "session",
      "*".repeat(100),
    );
    const components = messageComponents(message);
    expect(components).toHaveLength(38);
    expect(
      components.reduce(
        (length, component) => length + (component.content?.length ?? 0),
        0,
      ),
    ).toBeLessThanOrEqual(4000);
    expect(messageText(message).match(/\/info /gu)).toHaveLength(8);
    expect(messageText(message)).toContain("...");
    const container = message.components[0];
    if (container?.type !== ComponentType.Container)
      throw new Error("Expected container");
    expect(() => new ContainerBuilder(container).toJSON()).not.toThrow();
  });

  it("preserves website list links as compact footer links with room for navigation", () => {
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
    const message = createResourceListMessage(valid, "session");
    expect(
      messageText(message).match(
        /\[Open Resources\]\(<https:\/\/resources.fullparty.gg\/group>\)/gu,
      ),
    ).toHaveLength(4);
    const container = message.components[0];
    if (container?.type !== ComponentType.Container)
      throw new Error("Expected container");
    expect(container.components.at(-1)).toMatchObject({
      type: ComponentType.ActionRow,
      components: [{ label: "Previous" }, { label: "Next" }],
    });
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

  it("uses separate resource and embed titles, small dividers and indexed Show controls", () => {
    const message = createResourceListMessage(
      resourceListResponseSchema.parse(listResponse(1, 2)),
      "session",
    );
    expect(message.components).toHaveLength(1);
    const container = message.components[0];
    if (container?.type !== ComponentType.Container)
      throw new Error("Expected container");
    expect(container.accent_color).toBe(9912567);
    expect(container.components[1]).toEqual({
      type: ComponentType.Separator,
      divider: true,
      spacing: 1,
    });
    expect(container.components[2]).toEqual({
      type: ComponentType.Section,
      components: [
        {
          type: ComponentType.TextDisplay,
          content: "**/info bridges** - Choose Your Bridge\n-# DRS Bridge Positions",
        },
      ],
      accessory: {
        type: ComponentType.Button,
        label: "Show",
        style: 2,
        custom_id: "info:show:session:1:0",
      },
    });
    expect(container.components[3]).toEqual(container.components[1]);
    expect(container.components[4]).toMatchObject({
      type: ComponentType.Section,
      components: [
        {
          content: "**/info loadouts** - Recommended Loadouts\n-# Raid Preparation",
        },
      ],
      accessory: { custom_id: "info:show:session:1:1" },
    });
  });

  it("uses the actual embed title and author name over conflicting flat fields", () => {
    const result = resourceListResponseSchema.parse({
      ...listResponse(1, null),
      data: [
        {
          command_name: "drs-preparation",
          title: "Wrong Resource Title",
          embed_title: "Wrong Embed Title",
          embed: {
            title: "Prepare for Delubrum Reginae (Savage)",
            author: { name: "DRS Preparation" },
          },
        },
      ],
    });
    const text = messageText(createResourceListMessage(result, "session"));
    expect(text).toContain(
      "**/info drs-preparation** - Prepare for Delubrum Reginae (Savage)\n-# DRS Preparation",
    );
    expect(text).not.toContain("Wrong");
  });

  it("preserves explicit flat title metadata and never invents a resource title", () => {
    const result = resourceListResponseSchema.parse({
      ...listResponse(1, null),
      data: [
        { command_name: "missing", title: null },
        { command_name: "null", title: "Resource Title", embed_title: null },
        { command_name: "legacy", title: "Existing Title" },
        {
          command_name: "flat",
          title: "Resource Title",
          embed_title: "Embed Title",
        },
      ],
    });
    const text = messageText(createResourceListMessage(result, "session"));
    expect(text).toContain("**/info missing**");
    expect(text).not.toContain("**/info missing**\n-#");
    expect(text).toContain("**/info null**\n-# Resource Title");
    expect(text).toContain("**/info legacy** - Existing Title");
    expect(text).not.toContain("**/info legacy** - Existing Title\n-#");
    expect(text).toContain("**/info flat** - Embed Title\n-# Resource Title");
    expect(text).not.toContain("Untitled resource");
  });

  it("prefers the new explicit titles and respects null or blank resource titles", () => {
    const result = resourceListResponseSchema.parse({
      ...listResponse(1, null),
      data: [
        {
          command_name: "current",
          title: "Old alias",
          embed_title: "Before entering DRS",
          resource_title: "DRS Preparation Guide",
          embed: { title: "Old nested title", author: { name: "Old nested author" } },
        },
        ...[null, "   "].map((resource_title, index) => ({
          command_name: `empty-${String(index)}`,
          title: "Tank loadout",
          embed_title: "Tank loadout",
          resource_title,
        })),
        { command_name: "alias", title: "Alias title", resource_title: "Guide title" },
      ],
    });
    const message = createResourceListMessage(result, "session");
    expect(messageText(message)).toContain(
      "**/info current** - Before entering DRS\n-# DRS Preparation Guide",
    );
    expect(messageText(message)).not.toContain("Old");
    for (const name of ["empty-0", "empty-1"]) {
      expect(messageComponents(message)).toContainEqual({
        type: ComponentType.TextDisplay,
        content: `**/info ${name}** - Tank loadout`,
      });
    }
    expect(messageText(message)).toContain(
      "**/info alias** - Alias title\n-# Guide title",
    );
  });

  it("omits absent or blank actual embed fields without falling back to flat titles", () => {
    const result = resourceListResponseSchema.parse({
      ...listResponse(1, null),
      data: [
        { command_name: "empty", title: "Wrong", embed: {} },
        { command_name: "null", title: "Wrong", embed: null },
        {
          command_name: "title-only",
          title: "Wrong",
          embed: { title: "Actual Title", author: null },
        },
        {
          command_name: "author-only",
          title: "Wrong",
          embed_title: "Wrong",
          embed: { title: null, author: { name: "Actual Resource" } },
        },
        {
          command_name: "blank",
          title: "Wrong",
          embed: { title: "   ", author: { name: "\n " } },
        },
      ],
    });
    const message = createResourceListMessage(result, "session");
    const text = messageText(message);
    expect(text).toContain("**/info title-only** - Actual Title");
    expect(text).not.toContain("**/info title-only** - Actual Title\n-#");
    expect(text).toContain("**/info author-only**\n-# Actual Resource");
    expect(text).not.toContain("Wrong");
    for (const name of ["empty", "null", "blank"]) {
      expect(messageComponents(message)).toContainEqual({
        type: ComponentType.TextDisplay,
        content: `**/info ${name}**`,
      });
    }
  });

  it("escapes resource labels and search queries without allowing extra layout lines", () => {
    const result = resourceListResponseSchema.parse({
      ...listResponse(1, null),
      data: [
        {
          command_name: "*bridge*",
          title: "Unused Title",
          embed: {
            title: "[Link](https://example.com)",
            author: { name: "\n## Title" },
          },
        },
      ],
    });
    const text = messageText(
      createResourceListMessage(result, "session", "**query**\nline"),
    );
    expect(text).toContain("Matches for **\\*\\*query\\*\\* line**");
    expect(text).toContain("**/info \\*bridge\\*** - \\[Link](https://example.com)");
    expect(text).not.toContain("\n## Title");
  });

  it("preserves disabled list-link labels without making them clickable", () => {
    const result = resourceListResponseSchema.parse({
      ...listResponse(1, null),
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5,
              label: "Unavailable",
              url: "https://example.com",
              disabled: true,
            },
          ],
        },
      ],
    });
    const text = messageText(createResourceListMessage(result, "session"));
    expect(text).toContain("Unavailable (unavailable)");
    expect(text).not.toContain("https://example.com");
  });

  it("rejects oversized list links without silently dropping destinations", () => {
    const result = resourceListResponseSchema.parse({
      ...listResponse(1, null),
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5,
              label: "Resources",
              url: `https://example.com/${"a".repeat(4000)}`,
            },
          ],
        },
      ],
    });
    expect(() => createResourceListMessage(result, "session")).toThrow("cannot display");
  });

  it("shows separate useful messages for an empty list and an empty search", () => {
    const result = resourceListResponseSchema.parse({
      ...listResponse(1, null),
      data: [],
      meta: { ...listResponse(1, null).meta, total: 0, last_page: 1 },
    });
    expect(messageText(createResourceListMessage(result, "session"))).toContain(
      "No resources have been published",
    );
    expect(messageText(createResourceListMessage(result, "session", "bridge"))).toContain(
      "No resources matched your search.",
    );
    expect(
      messageComponents(createResourceListMessage(result, "session")).filter(
        (component) => component.label === "Show",
      ),
    ).toHaveLength(0);
  });

  it("rejects pages above eight entries in both list and search responses", async () => {
    const result = {
      ...listResponse(1, null),
      data: Array.from({ length: 9 }, () => ({
        command_name: "bridge",
        title: "Bridge",
      })),
      meta: { ...listResponse(1, null).meta, per_page: 9, total: 9, last_page: 1 },
    };
    const service = new GuildResourceService({
      listDiscordGuildResources: () => Promise.resolve(result),
      getDiscordGuildResource: () => Promise.resolve({ found: false, ...result }),
      getDiscordGuildResourceAsset: () => Promise.resolve(Buffer.alloc(0)),
    });
    await expect(service.list("123")).rejects.toMatchObject({
      code: "invalid_resource_response",
    });
    await expect(service.lookup("123", "bridge")).rejects.toMatchObject({
      code: "invalid_resource_response",
    });
    expect(() =>
      createResourceListMessage({ ...result, components: [] }, "session"),
    ).toThrow("cannot display");
  });

  it("POSTs authenticated list requests one page at a time", async () => {
    const bodies: unknown[] = [];
    const fetcher = vi.fn<typeof fetch>((url, init) => {
      expect(fetchUrl(url)).toBe(
        "https://fullparty.gg/api/integrations/v1/bot/resources/list",
      );
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
      { discord_guild_id: "123", page: 1, per_page: 8 },
      { discord_guild_id: "123", page: 2, per_page: 8 },
    ]);
  });

  it("fetches an encoded resource name without changing it or dropping guild context", async () => {
    const fetcher = vi.fn<typeof fetch>((url, init) => {
      expect(fetchUrl(url)).toBe(
        "https://fullparty.gg/api/integrations/v1/bot/resources/Bridge%20%26%20Positions",
      );
      expect(init?.method).toBe("POST");
      expect(fetchJsonBody(init)).toEqual({
        discord_guild_id: "123",
        page: 1,
        per_page: 8,
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
    expect(message.flags).toBe(MessageFlags.IsComponentsV2);
    expect(message).not.toHaveProperty("embeds");
    expect(message).not.toHaveProperty("content");
    expect(message.allowedMentions).toEqual({ parse: [], repliedUser: false });
    expect(messageText(message)).toContain("**/info positions**");
    expect(messageText(message)).toContain("3 resources | Page 2/2");
    expect(JSON.stringify(message.components)).toContain("info:show:session-id:2:0");
    expect(JSON.stringify(message.components)).toContain("info:previous:session-id:1");
    expect(JSON.stringify(message.components)).toContain("info:next:session-id:2");
  });

  it("uses distinct disabled controls on a single page and does not invent public links", () => {
    const result = listResponse(1, null);
    const message = createResourceListMessage(
      { ...result, meta: { ...result.meta, last_page: 1 }, components: [] },
      "session-id",
    );
    const container = message.components[0];
    if (container?.type !== ComponentType.Container)
      throw new Error("Expected container");
    const controls = container.components.at(-1);
    if (controls?.type !== ComponentType.ActionRow) throw new Error("Expected controls");
    expect(controls).toMatchObject({
      components: [
        { custom_id: "info:previous:session-id:1", disabled: true },
        { custom_id: "info:next:session-id:1", disabled: true },
      ],
    });
  });
});
