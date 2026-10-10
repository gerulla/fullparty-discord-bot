import {
  type ChatInputCommandInteraction,
  type Interaction,
  EmbedBuilder,
  MessageFlags,
  PermissionsBitField,
  PermissionFlagsBits,
} from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BotContext } from "../src/bot/context.js";
import { infoCommand } from "../src/commands/info.js";
import { helpCommand } from "../src/commands/help.js";
import { FullpartyApiClient } from "../src/fullparty/client.js";
import type { ResourceMessage } from "../src/fullparty/resources/messages.js";
import { createInteractionHandler } from "../src/interactions/handleInteraction.js";
import { LatestPayloadStore } from "../src/payloads/latestPayloadStore.js";
import { fetchJsonBody, fetchUrl } from "./helpers/http.js";
import { messageComponents, messageText } from "./helpers/messages.js";

const links = [
  {
    type: 1,
    components: [
      {
        type: 2,
        style: 5,
        label: "Open Resource",
        url: "https://resources.fullparty.gg/example",
      },
    ],
  },
];
const resource = {
  command_name: "bridges",
  embed: {
    title: "DRS Bridge Positions",
    image: { url: "attachment://bridges.png" },
    footer: { text: "FullParty" },
  },
  assets: [
    {
      id: "image-id",
      filename: "bridges.png",
      mime_type: "image/png",
      url: "https://fullparty.gg/api/integrations/v1/bot/discord-guilds/123/resource-commands/bridges/assets/image-id",
    },
  ],
  components: links,
};
function list(page = 1, total = 2) {
  return {
    data: total
      ? [
          {
            command_name: page === 1 ? "drs-healer" : "drs-tank",
            title: "DRS Loadouts",
            embed: { title: "DRS Loadouts", author: { name: "DRS Preparation" } },
          },
        ]
      : [],
    meta: {
      group_id: 42,
      discord_guild_id: "123",
      current_page: page,
      per_page: 1,
      total,
      last_page: Math.max(1, total),
      next_page: page < total ? page + 1 : null,
    },
  };
}
function context(fetcher: typeof fetch, linked = true) {
  return {
    fullparty: new FullpartyApiClient({ baseUrl: "https://fullparty.gg/api", fetcher }),
    fullpartyWebBaseUrl: "https://fullparty.gg",
    payloads: new LatestPayloadStore(),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    guildSettings: {
      get: (guildId) =>
        Promise.resolve({
          guildId,
          syncDiscordNamesToFf14: false,
          ...(linked ? { linkedAt: "2026-09-10T00:00:00Z" } : {}),
        }),
      update: (guildId) => Promise.resolve({ guildId, syncDiscordNamesToFf14: false }),
    },
  } satisfies BotContext;
}
function command(name: string | null = null) {
  const interaction = {
    commandName: "info",
    guildId: "123",
    user: { id: "456" },
    attachmentSizeLimit: 10 * 1024 * 1024,
    appPermissions: new PermissionsBitField([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.SendMessages,
    ]),
    options: { getString: vi.fn(() => name) },
    isChatInputCommand: () => true,
    reply: vi.fn<ChatInputCommandInteraction["reply"]>(),
    deferReply: vi.fn<() => Promise<void>>(),
    editReply: vi.fn<ChatInputCommandInteraction["editReply"]>(),
    followUp: vi.fn<ChatInputCommandInteraction["followUp"]>(),
    deleteReply: vi.fn<ChatInputCommandInteraction["deleteReply"]>(),
    deferred: false,
  };
  interaction.deferReply.mockImplementation(() => {
    interaction.deferred = true;
    return Promise.resolve(undefined);
  });
  return interaction;
}
function button(customId: string) {
  const interaction = {
    ...command(),
    customId,
    isChatInputCommand: () => false,
    isButton: () => true,
    deferUpdate: vi.fn<() => Promise<void>>(),
  };
  interaction.deferUpdate.mockImplementation(() => {
    interaction.deferred = true;
    return Promise.resolve(undefined);
  });
  return interaction;
}
function next(message: unknown): string {
  return controlId(message, "Next");
}
function controlId(message: unknown, label: string): string {
  const id = messageComponents(message).find((c) => c.label === label)?.custom_id;
  if (!id) throw new Error(`Expected ${label} button`);
  return id;
}
async function run(interaction: ReturnType<typeof command>, ctx: BotContext) {
  await createInteractionHandler(ctx, [infoCommand])(
    interaction as unknown as Interaction,
  );
}
afterEach(() => vi.useRealTimers());

describe("/info", () => {
  it.each([
    { name: "member", permissions: [] },
    { name: "administrator", permissions: [PermissionFlagsBits.Administrator] },
  ])(
    "includes resources in $name help within Discord's message limit",
    async ({ permissions }) => {
      const interaction = {
        ...command(),
        inGuild: () => true,
        memberPermissions: new PermissionsBitField(permissions),
        member: { roles: [] },
      };
      await helpCommand.execute(
        interaction as unknown as ChatInputCommandInteraction,
        context(vi.fn<typeof fetch>()),
      );
      expect(interaction.deferReply).toHaveBeenCalledWith({
        flags: MessageFlags.Ephemeral,
      });
      expect(interaction.reply).not.toHaveBeenCalled();
      const reply = interaction.editReply.mock.calls[0]?.[0];
      if (
        typeof reply !== "object" ||
        !("content" in reply) ||
        typeof reply.content !== "string"
      )
        throw new Error("Expected help content");
      expect(reply.content).toContain("/info");
      expect(reply.content.length).toBeLessThanOrEqual(2000);
    },
  );
  it("keeps the main list private for any member with Show controls and supplied links", async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ ...list(), components: links })),
    );
    const interaction = command();
    await run(interaction, context(fetcher));
    expect(interaction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
    expect(interaction.followUp).not.toHaveBeenCalled();
    const message = interaction.editReply.mock.calls[0]?.[0];
    expect(message).toHaveProperty("flags", MessageFlags.IsComponentsV2);
    expect(JSON.stringify(message)).toContain("/info drs-healer");
    expect(JSON.stringify(message)).not.toContain("/info name:");
    expect(JSON.stringify(message)).toContain("https://resources.fullparty.gg/example");
    expect(next(message)).toMatch(/^info:next:[a-f0-9]{24}:2$/u);
    expect(controlId(message, "Show")).toMatch(/^info:show:[a-f0-9]{24}:1:0$/u);
    expect(interaction.deleteReply).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([null, "drs"])(
    "renders the explicit list titles for %s with no metadata lookups",
    async (query) => {
      const payload = {
        found: false,
        data: [
          {
            command_name: "drs-preparation",
            title: "Before entering DRS",
            embed_title: "Before entering DRS",
            resource_title: "DRS Preparation Guide",
          },
          {
            command_name: "drs-tank",
            title: "Tank loadout",
            embed_title: "Tank loadout",
            resource_title: "DRS Holster Recommendations",
          },
        ],
        meta: {
          group_id: 1,
          discord_guild_id: "123456789012345678",
          current_page: 1,
          per_page: 25,
          total: 2,
          last_page: 1,
          next_page: null,
        },
      };
      const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(payload)));
      const interaction = command(query);
      interaction.guildId = payload.meta.discord_guild_id;
      await run(interaction, context(fetcher));
      const message = interaction.editReply.mock.calls[0]?.[0];
      expect(messageText(message)).toContain(
        "**/info drs-preparation** - Before entering DRS\n-# DRS Preparation Guide",
      );
      expect(messageText(message)).toContain(
        "**/info drs-tank** - Tank loadout\n-# DRS Holster Recommendations",
      );
      expect(messageComponents(message).filter((c) => c.label === "Show")).toHaveLength(
        2,
      );
      expect(interaction.deferReply).toHaveBeenCalledWith({
        flags: MessageFlags.Ephemeral,
      });
      expect(interaction.followUp).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetchJsonBody(fetcher.mock.calls[0]?.[1])).toEqual({
        discord_guild_id: payload.meta.discord_guild_id,
        page: 1,
        per_page: 8,
      });
    },
  );
  it.each([null, "bridge"])(
    "uses the actual embed title and author for legacy %s results without posting or downloading assets",
    async (query) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json({
            ...(query ? { found: false } : {}),
            ...list(1, 1),
            data: [{ command_name: "bridges", title: "Legacy list title" }],
          }),
        )
        .mockResolvedValueOnce(
          Response.json({
            found: true,
            data: {
              ...resource,
              embed: { ...resource.embed, author: { name: "DRS Preparation" } },
            },
          }),
        );
      const interaction = command(query);
      await run(interaction, context(fetcher));
      const message = interaction.editReply.mock.calls[0]?.[0];
      expect(messageText(message)).toContain(
        "**/info bridges** - DRS Bridge Positions\n-# DRS Preparation",
      );
      expect(messageText(message)).not.toContain("Legacy list title");
      expect(interaction.followUp).not.toHaveBeenCalled();
      expect(interaction.deleteReply).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledTimes(2);
      const metadataRequest = fetcher.mock.calls[1];
      if (!metadataRequest) throw new Error("Expected a resource metadata lookup");
      expect(fetchUrl(metadataRequest[0])).toBe(
        "https://fullparty.gg/api/integrations/v1/bot/resources/bridges",
      );
    },
  );
  it.each([null, "bridge"])(
    "posts the chosen resource from %s privately browsed results and dismisses the list",
    async (query) => {
      const bytes = new Uint8Array([137, 80, 78, 71]);
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json({
            ...(query ? { found: false } : {}),
            ...list(),
            data: [
              {
                command_name: "bridges",
                title: "Raid resources",
                embed_title: "DRS Bridge Positions",
              },
            ],
          }),
        )
        .mockResolvedValueOnce(Response.json({ found: true, data: resource }))
        .mockResolvedValueOnce(new Response(bytes));
      const ctx = context(fetcher);
      const original = command(query);
      await run(original, ctx);
      const show = button(controlId(original.editReply.mock.calls[0]?.[0], "Show"));
      show.appPermissions.add(PermissionFlagsBits.AttachFiles);
      await run(show, ctx);
      expect(show.deferUpdate).toHaveBeenCalledOnce();
      expect(show.editReply).not.toHaveBeenCalled();
      expect(show.deleteReply).toHaveBeenCalledOnce();
      expect(original.followUp).not.toHaveBeenCalled();
      expect(show.followUp).toHaveBeenCalledOnce();
      expect(show.deleteReply.mock.invocationCallOrder[0]).toBeGreaterThan(
        show.followUp.mock.invocationCallOrder[0] ?? Infinity,
      );
      const posted = show.followUp.mock.calls[0]?.[0];
      expect(posted).not.toHaveProperty("flags");
      expect(posted).toMatchObject({
        files: [{ attachment: Buffer.from(bytes), name: "bridges.png" }],
        allowedMentions: { parse: [], repliedUser: false },
      });
      expect(JSON.stringify(posted)).toContain("attachment://bridges.png");
      expect(JSON.stringify(posted)).toContain("Open Resource");
      const lookupRequest = fetcher.mock.calls[1];
      if (!lookupRequest) throw new Error("Expected a selected resource lookup");
      expect(fetchUrl(lookupRequest[0])).toBe(
        "https://fullparty.gg/api/integrations/v1/bot/resources/bridges",
      );
      expect(fetchJsonBody(fetcher.mock.calls[1]?.[1])).toEqual({
        discord_guild_id: "123",
        page: 1,
        per_page: 8,
      });
    },
  );

  it.each([false, true])(
    "retires a successful Show selection even when cleanup fails: %s",
    async (cleanupFails) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json(list()))
        .mockResolvedValueOnce(
          Response.json({
            found: true,
            data: {
              ...resource,
              command_name: "drs-healer",
              embed: { title: "DRS Loadouts" },
              assets: [],
            },
          }),
        );
      const ctx = context(fetcher);
      const original = command();
      await run(original, ctx);
      const customId = controlId(original.editReply.mock.calls[0]?.[0], "Show");
      const show = button(customId);
      if (cleanupFails)
        show.deleteReply.mockRejectedValue(new Error("Discord unavailable"));
      await run(show, ctx);
      expect(show.followUp).toHaveBeenCalledOnce();
      expect(show.deleteReply).toHaveBeenCalledOnce();
      expect(ctx.logger.error).not.toHaveBeenCalled();
      if (cleanupFails) expect(ctx.logger.warn).toHaveBeenCalledOnce();

      const retry = button(customId);
      await run(retry, ctx);
      expect(retry.reply).toHaveBeenCalledWith({
        content: "That resource list control is no longer valid. Run `/info` again.",
        flags: MessageFlags.Ephemeral,
      });
      expect(retry.followUp).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );

  it("publishes once for concurrent Show clicks and releases failed attempts for retry", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(list()))
      .mockResolvedValueOnce(Response.json({}, { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({
          found: true,
          data: {
            ...resource,
            command_name: "drs-healer",
            embed: { title: "DRS Loadouts" },
            assets: [],
          },
        }),
      );
    const ctx = context(fetcher);
    const original = command();
    await run(original, ctx);
    const customId = controlId(original.editReply.mock.calls[0]?.[0], "Show");
    const first = button(customId);
    let release: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    first.deferUpdate.mockImplementation(() => {
      first.deferred = true;
      return blocked;
    });
    const pending = run(first, ctx);
    try {
      const duplicate = button(customId);
      await run(duplicate, ctx);
      expect(duplicate.reply).toHaveBeenCalledWith({
        content: "A resource from this list is already being posted. Please wait.",
        flags: MessageFlags.Ephemeral,
      });
      expect(duplicate.deferUpdate).not.toHaveBeenCalled();
      expect(duplicate.followUp).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      release();
    }
    await pending;
    expect(first.deleteReply).not.toHaveBeenCalled();

    const retry = button(customId);
    await run(retry, ctx);
    expect(retry.followUp).toHaveBeenCalledOnce();
    expect(retry.followUp.mock.calls[0]?.[0]).not.toHaveProperty("flags");
    expect(retry.deleteReply).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("keeps the clicked name when the same page changes while Show is acknowledging", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          ...list(),
          data: [
            { command_name: "bridges", title: "Bridges", embed: { title: "Bridges" } },
          ],
        }),
      )
      .mockResolvedValueOnce(Response.json(list(2)))
      .mockResolvedValueOnce(
        Response.json({
          ...list(),
          data: [
            {
              command_name: "positions",
              title: "Reordered resource",
              embed: { title: "Reordered resource" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          found: true,
          data: { ...resource, embed: { title: "Bridges" }, assets: [] },
        }),
      );
    const ctx = context(fetcher);
    const original = command();
    await run(original, ctx);
    const firstPage = original.editReply.mock.calls[0]?.[0];
    const show = button(controlId(firstPage, "Show"));
    let release: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    show.deferUpdate.mockImplementation(() => {
      show.deferred = true;
      return blocked;
    });
    const pendingShow = run(show, ctx);
    expect(show.deferUpdate).toHaveBeenCalledOnce();
    try {
      const nextPage = button(next(firstPage));
      await run(nextPage, ctx);
      const previous = button(
        controlId(nextPage.editReply.mock.calls[0]?.[0], "Previous"),
      );
      await run(previous, ctx);
      expect(JSON.stringify(previous.editReply.mock.calls)).toContain("/info positions");
    } finally {
      release();
    }
    await pendingShow;
    const lookupRequest = fetcher.mock.calls[3];
    if (!lookupRequest) throw new Error("Expected a selected resource lookup");
    expect(fetchUrl(lookupRequest[0])).toBe(
      "https://fullparty.gg/api/integrations/v1/bot/resources/bridges",
    );
    expect(JSON.stringify(show.followUp.mock.calls)).toContain("Bridges");
    expect(show.editReply).not.toHaveBeenCalled();
  });

  it("does not edit a dismissed list when an earlier page request finishes later", async () => {
    let release: (response: Response) => void = () => undefined;
    const blocked = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(list()))
      .mockImplementationOnce(() => blocked)
      .mockResolvedValueOnce(
        Response.json({
          found: true,
          data: {
            ...resource,
            command_name: "drs-healer",
            embed: { title: "DRS Loadouts" },
            assets: [],
          },
        }),
      );
    const ctx = context(fetcher);
    const original = command();
    await run(original, ctx);
    const message = original.editReply.mock.calls[0]?.[0];
    const page = button(next(message));
    const pendingPage = run(page, ctx);
    try {
      await vi.waitFor(() => {
        expect(fetcher).toHaveBeenCalledTimes(2);
      });
      const show = button(controlId(message, "Show"));
      await run(show, ctx);
      expect(show.deleteReply).toHaveBeenCalledOnce();
    } finally {
      release(Response.json(list(2)));
    }
    await pendingPage;
    expect(page.editReply).not.toHaveBeenCalled();
    expect(page.followUp).not.toHaveBeenCalled();
    expect(ctx.logger.error).not.toHaveBeenCalled();
  });

  it("rejects stale and forged Show selections before requesting a resource", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(list()))
      .mockResolvedValueOnce(Response.json(list(2)));
    const ctx = context(fetcher);
    const original = command();
    await run(original, ctx);
    const firstMessage = original.editReply.mock.calls[0]?.[0];
    const staleId = controlId(firstMessage, "Show");
    const page = button(next(firstMessage));
    await run(page, ctx);
    const currentId = controlId(page.editReply.mock.calls[0]?.[0], "Show");
    for (const id of [
      staleId,
      currentId.replace(/:0$/u, ":7"),
      currentId.replace(/:0$/u, ":-1"),
    ]) {
      const show = button(id);
      await run(show, ctx);
      expect(show.editReply).not.toHaveBeenCalled();
      expect(show.deleteReply).not.toHaveBeenCalled();
      const error = show.reply.mock.calls[0]?.[0] ?? show.followUp.mock.calls[0]?.[0];
      expect(error).toHaveProperty("flags", MessageFlags.Ephemeral);
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    "gone",
    "lookup_error",
    "no_attach_permission",
    "send_error",
    "no_send_permission",
  ])("keeps Show failures private and leaves the list intact: %s", async (failure) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          ...list(),
          data: [
            { command_name: "bridges", title: "Bridges", embed: { title: "Bridges" } },
          ],
        }),
      )
      .mockResolvedValueOnce(
        failure === "lookup_error"
          ? Response.json({}, { status: 503 })
          : failure === "gone"
            ? Response.json({ found: false, ...list(1, 0) })
            : Response.json({
                found: true,
                data:
                  failure === "no_attach_permission"
                    ? resource
                    : { ...resource, embed: { title: "Bridges" }, assets: [] },
              }),
      );
    const ctx = context(fetcher);
    const original = command();
    await run(original, ctx);
    const show = button(controlId(original.editReply.mock.calls[0]?.[0], "Show"));
    if (failure === "send_error")
      show.followUp.mockRejectedValueOnce(new Error("Missing access"));
    if (failure === "no_send_permission") show.appPermissions = new PermissionsBitField();
    await run(show, ctx);
    expect(show.editReply).not.toHaveBeenCalled();
    expect(show.deleteReply).not.toHaveBeenCalled();
    expect(show.followUp).toHaveBeenLastCalledWith(
      expect.objectContaining({
        flags: MessageFlags.Ephemeral,
        content: expect.any(String) as unknown,
      }),
    );
    expect(fetcher).toHaveBeenCalledTimes(failure === "no_send_permission" ? 1 : 2);
  });

  it("posts an exact match publicly with canonical name, attachments and supplied buttons", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const fetcher = vi.fn<typeof fetch>((_url, init) =>
      Promise.resolve(
        init?.method === "GET"
          ? new Response(bytes)
          : Response.json({ found: true, data: resource }),
      ),
    );
    const interaction = command("BRIDGES");
    interaction.appPermissions.add(PermissionFlagsBits.AttachFiles);
    await run(interaction, context(fetcher));
    const message = interaction.followUp.mock.calls[0]?.[0] as
      | ResourceMessage
      | undefined;
    expect(message?.embeds).toHaveLength(1);
    expect(JSON.stringify(message?.embeds)).toContain("attachment://bridges.png");
    expect(message?.files).toEqual([
      { attachment: Buffer.from(bytes), name: "bridges.png" },
    ]);
    expect(JSON.stringify(message?.components)).toBe(JSON.stringify(links));
    expect(message).not.toHaveProperty("data");
    expect(message).not.toHaveProperty("flags");
    expect(interaction.deleteReply).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("posts the automatic resource link and custom links together without fetching their URLs", async () => {
    const response = {
      found: true,
      data: {
        command_name: "drs-preparation",
        embed: {
          title: "Prepare for Delubrum Reginae (Savage)",
          description: "Check the strategy and join our Discord before the run.",
          color: 5793266,
          author: {
            name: "DRS Preparation",
            url: "https://resources.example.com/group/7c23b50a-538c-48a1-90e9-171efcb8ec29",
          },
          timestamp: "2026-09-14T12:00:00+00:00",
          footer: { text: "FullParty" },
        },
        assets: [],
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 5,
                label: "Open resource",
                url: "https://resources.example.com/group/7c23b50a-538c-48a1-90e9-171efcb8ec29",
              },
              {
                type: 2,
                style: 5,
                label: "Read the strategy",
                url: "https://example.com/drs-strategy",
              },
              {
                type: 2,
                style: 5,
                label: "Join Discord",
                url: "https://discord.gg/example",
              },
            ],
          },
        ],
      },
    };
    const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(response)));
    const interaction = command("drs-preparation");
    await run(interaction, context(fetcher));

    expect(interaction.followUp).toHaveBeenCalledTimes(1);
    const message = interaction.followUp.mock.calls[0]?.[0] as
      | ResourceMessage
      | undefined;
    const embed = message?.embeds?.[0];
    if (!(embed instanceof EmbedBuilder)) throw new Error("Expected a resource embed");
    expect(message?.embeds).toHaveLength(1);
    expect(embed.toJSON()).toEqual({
      ...response.data.embed,
      timestamp: "2026-09-14T12:00:00.000Z",
    });
    expect(JSON.stringify(message?.components)).toBe(
      JSON.stringify(response.data.components),
    );
    expect(message).not.toHaveProperty("flags");
    expect(message?.files).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const request = fetcher.mock.calls[0];
    if (!request) throw new Error("Expected a FullParty API request");
    expect(fetchUrl(request[0])).toBe(
      "https://fullparty.gg/api/integrations/v1/bot/resources/drs-preparation",
    );
  });
  it("does not add public URLs/buttons to restricted resources", async () => {
    const ctx = context(() =>
      Promise.resolve(
        Response.json({
          found: true,
          data: {
            command_name: "bridges",
            embed: { title: "Bridges", author: { name: "Team", url: null } },
            assets: [],
            components: [],
          },
        }),
      ),
    );
    const interaction = command("bridges");
    await run(interaction, ctx);
    const message = interaction.followUp.mock.calls[0]?.[0];
    expect(message).toMatchObject({ components: [] });
    expect(JSON.stringify(message)).not.toContain('"url"');
  });
  it.each([null, "DRS"])(
    "paginates %s using the same endpoint/query and edits the existing message",
    async (query) => {
      const fetcher = vi.fn<typeof fetch>((url, init) => {
        expect(fetchUrl(url)).toBe(
          `https://fullparty.gg/api/integrations/v1/bot/resources/${query ?? "list"}`,
        );
        const body = fetchJsonBody(init) as { page: number };
        return Promise.resolve(
          Response.json({ ...(query ? { found: false } : {}), ...list(body.page) }),
        );
      });
      const ctx = context(fetcher);
      const interaction = command(query);
      await run(interaction, ctx);
      if (query) {
        expect(interaction.deferReply).toHaveBeenCalledWith({
          flags: MessageFlags.Ephemeral,
        });
        expect(interaction.followUp).not.toHaveBeenCalled();
        expect(interaction.deleteReply).not.toHaveBeenCalled();
        expect(JSON.stringify(interaction.editReply.mock.calls)).toContain(
          "FullParty Resource Search",
        );
      }
      const page = button(next(interaction.editReply.mock.calls[0]?.[0]));
      await run(page, ctx);
      expect(page.deferUpdate).toHaveBeenCalled();
      expect(page.followUp).not.toHaveBeenCalled();
      expect(JSON.stringify(page.editReply.mock.calls)).toContain("Page 2/2");
      expect(JSON.stringify(page.editReply.mock.calls)).toContain("drs-tank");
      expect(JSON.stringify(page.editReply.mock.calls)).not.toContain("drs-healer");
      expect(fetchJsonBody(fetcher.mock.calls[1]?.[1])).toEqual({
        discord_guild_id: "123",
        page: 2,
        per_page: 8,
      });
    },
  );
  it.each([null, "missing"])("keeps empty responses private (%s)", async (name) => {
    const interaction = command(name);
    await run(
      interaction,
      context(() =>
        Promise.resolve(
          Response.json({ ...(name ? { found: false } : {}), ...list(1, 0) }),
        ),
      ),
    );
    expect(interaction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
    expect(JSON.stringify(interaction.editReply.mock.calls)).toContain(
      name ? "No resources matched" : "No resources have been published",
    );
    expect(interaction.followUp).not.toHaveBeenCalled();
  });
  it.each([403, 404, 503])("keeps API %s errors private", async (status) => {
    const interaction = command("bridges");
    await run(
      interaction,
      context(() => Promise.resolve(Response.json({}, { status }))),
    );
    expect(interaction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(interaction.editReply.mock.calls[0]?.[0]).toHaveProperty("content");
    expect(interaction.followUp).not.toHaveBeenCalled();
  });
  it("explains missing attachment permissions before downloading files", async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ found: true, data: resource })),
    );
    const interaction = command("bridges");
    await run(interaction, context(fetcher));
    expect(JSON.stringify(interaction.editReply.mock.calls)).toContain(
      "Attach Files permission",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).not.toHaveBeenCalled();
  });
  it("rejects unlinked guilds and missing permissions before calling FullParty", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const unlinked = command();
    await run(unlinked, context(fetcher, false));
    expect(JSON.stringify(unlinked.editReply.mock.calls)).toContain("not linked");
    const forbidden = command();
    forbidden.appPermissions = new PermissionsBitField();
    await run(forbidden, context(fetcher));
    expect(JSON.stringify(forbidden.editReply.mock.calls)).toContain("Embed Links");
    const dm = { ...command(), guildId: null, deferred: true };
    await createInteractionHandler(context(fetcher), [infoCommand])(
      dm as unknown as Interaction,
    );
    expect(JSON.stringify(dm.editReply.mock.calls)).toContain("only be used inside");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["Next", "Show"])(
    "restricts %s to its requesting user/guild and expires it after 15 minutes",
    async (label) => {
      vi.useFakeTimers();
      const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(list())));
      const ctx = context(fetcher);
      const interaction = command();
      await run(interaction, ctx);
      const id = controlId(interaction.editReply.mock.calls[0]?.[0], label);
      const otherUser = button(id);
      otherUser.user.id = "999";
      await run(otherUser, ctx);
      expect(JSON.stringify(otherUser.reply.mock.calls)).toContain("Only the person");
      const otherGuild = button(id);
      otherGuild.guildId = "789";
      await run(otherGuild, ctx);
      expect(JSON.stringify(otherGuild.reply.mock.calls)).toContain("no longer valid");
      vi.advanceTimersByTime(15 * 60_000);
      const expired = button(id);
      await run(expired, ctx);
      expect(JSON.stringify(expired.reply.mock.calls)).toContain("no longer valid");
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["api_error", "empty", "exact_match"])(
    "keeps pagination failures private (%s)",
    async (failure) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({ found: false, ...list() }))
        .mockResolvedValueOnce(
          failure === "api_error"
            ? Response.json({}, { status: 503 })
            : failure === "empty"
              ? Response.json({ found: false, ...list(2, 0) })
              : Response.json({
                  found: true,
                  data: {
                    command_name: "drs",
                    embed: { title: "New resource" },
                    assets: [],
                    components: [],
                  },
                }),
        );
      const ctx = context(fetcher);
      const interaction = command("drs");
      await run(interaction, ctx);
      const page = button(next(interaction.editReply.mock.calls[0]?.[0]));
      await run(page, ctx);
      expect(page.editReply).not.toHaveBeenCalled();
      expect(page.followUp.mock.calls[0]?.[0]).toHaveProperty("content");
      expect(page.followUp.mock.calls[0]?.[0]).toHaveProperty(
        "flags",
        MessageFlags.Ephemeral,
      );
    },
  );
  it("does not mark successful posts as failed if private acknowledgement deletion fails", async () => {
    const ctx = context(() =>
      Promise.resolve(
        Response.json({
          found: true,
          data: { ...resource, embed: { title: "Bridges" }, assets: [] },
        }),
      ),
    );
    const interaction = command("bridges");
    interaction.deleteReply.mockRejectedValue(new Error("Discord unavailable"));
    await run(interaction, ctx);
    expect(interaction.followUp).toHaveBeenCalledTimes(1);
    expect(ctx.logger.warn).toHaveBeenCalled();
    expect(ctx.logger.error).not.toHaveBeenCalled();
  });
  it("keeps even a single non-exact search result private", async () => {
    const interaction = command("drs");
    await run(
      interaction,
      context(() => Promise.resolve(Response.json({ found: false, ...list(1, 1) }))),
    );
    expect(JSON.stringify(interaction.editReply.mock.calls)).toContain("drs-healer");
    expect(interaction.followUp).not.toHaveBeenCalled();
  });
  it("leaves the private list untouched when a later API page fails", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(list()))
      .mockResolvedValueOnce(Response.json({}, { status: 503 }));
    const ctx = context(fetcher);
    const interaction = command();
    await run(interaction, ctx);
    const page = button(next(interaction.editReply.mock.calls[0]?.[0]));
    await run(page, ctx);
    expect(page.editReply).not.toHaveBeenCalled();
    expect(page.followUp.mock.calls[0]?.[0]).toHaveProperty("content");
    expect(page.followUp.mock.calls[0]?.[0]).toHaveProperty(
      "flags",
      MessageFlags.Ephemeral,
    );
  });
  it("keeps the error private if publishing the public reply fails", async () => {
    const interaction = command("bridges");
    interaction.followUp.mockRejectedValue(new Error("Missing access"));
    await run(
      interaction,
      context(() =>
        Promise.resolve(
          Response.json({
            found: true,
            data: { ...resource, embed: { title: "Bridges" }, assets: [] },
          }),
        ),
      ),
    );
    expect(interaction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
    expect(interaction.editReply).toHaveBeenLastCalledWith({
      content: "Something went wrong while running that command.",
    });
    expect(interaction.deleteReply).not.toHaveBeenCalled();
  });
});
