import {
  type ChatInputCommandInteraction,
  type Interaction,
  ActionRowBuilder,
  ButtonBuilder,
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
      url: "https://fullparty.gg/api/integrations/discord-guilds/123/resource-commands/bridges/assets/image-id",
    },
  ],
  components: links,
};
function list(page = 1, total = 2) {
  return {
    data: total
      ? [{ command_name: page === 1 ? "drs-healer" : "drs-tank", title: "DRS Loadouts" }]
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
  if (
    typeof message !== "object" ||
    !message ||
    !("components" in message) ||
    !Array.isArray(message.components)
  )
    throw new Error("Expected components");
  const row: unknown = message.components[0];
  if (!(row instanceof ActionRowBuilder)) throw new Error("Expected action row");
  const control: unknown = row.components[1];
  if (!(control instanceof ButtonBuilder)) throw new Error("Expected next button");
  const json = control.toJSON();
  if (!("custom_id" in json)) throw new Error("Expected a custom ID");
  return json.custom_id;
}
async function run(interaction: ReturnType<typeof command>, ctx: BotContext) {
  await createInteractionHandler(ctx, [infoCommand])(
    interaction as unknown as Interaction,
  );
}
afterEach(() => vi.useRealTimers());

describe("/info", () => {
  it("fits the help entry within Discord's message limit", async () => {
    const interaction = { ...command(), inGuild: () => true };
    await helpCommand.execute(
      interaction as unknown as ChatInputCommandInteraction,
      context(vi.fn<typeof fetch>()),
    );
    const reply = interaction.reply.mock.calls[0]?.[0];
    if (
      typeof reply !== "object" ||
      !("content" in reply) ||
      typeof reply.content !== "string"
    )
      throw new Error("Expected help content");
    expect(reply.content).toContain("/info");
    expect(reply.content.length).toBeLessThanOrEqual(2000);
  });
  it("posts the main list publicly with its supplied public-page button for any member", async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ ...list(), components: links })),
    );
    const interaction = command();
    await run(interaction, context(fetcher));
    expect(interaction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
    expect(interaction.followUp).toHaveBeenCalledTimes(1);
    const message = interaction.followUp.mock.calls[0]?.[0];
    expect(message).not.toHaveProperty("flags");
    expect(JSON.stringify(message)).toContain("/info name:drs-healer");
    expect(JSON.stringify(message)).toContain("https://resources.fullparty.gg/example");
    expect(next(message)).toMatch(/^info:next:[a-f0-9]{24}:2$/u);
    expect(interaction.editReply.mock.invocationCallOrder[0]).toBeLessThan(
      interaction.followUp.mock.invocationCallOrder[0] ?? 0,
    );
    expect(interaction.deleteReply.mock.invocationCallOrder[0]).toBeGreaterThan(
      interaction.followUp.mock.invocationCallOrder[0] ?? 0,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
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
          `https://fullparty.gg/api/integrations/resources/${query ?? "list"}`,
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
      const page = button(
        next(
          query
            ? interaction.editReply.mock.calls[0]?.[0]
            : interaction.followUp.mock.calls[0]?.[0],
        ),
      );
      await run(page, ctx);
      expect(page.deferUpdate).toHaveBeenCalled();
      expect(page.followUp).not.toHaveBeenCalled();
      expect(JSON.stringify(page.editReply.mock.calls)).toContain("Page 2/2");
      expect(JSON.stringify(page.editReply.mock.calls)).toContain("drs-tank");
      expect(JSON.stringify(page.editReply.mock.calls)).not.toContain("drs-healer");
      expect(fetchJsonBody(fetcher.mock.calls[1]?.[1])).toEqual({
        discord_guild_id: "123",
        page: 2,
        per_page: 10,
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
  it("restricts pagination to its requesting user/guild and expires it after 15 minutes", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(list())));
    const ctx = context(fetcher);
    const interaction = command();
    await run(interaction, ctx);
    const id = next(interaction.followUp.mock.calls[0]?.[0]);
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
  });
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
    const ctx = context(() => Promise.resolve(Response.json(list())));
    const interaction = command();
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
  it("leaves public lists untouched when a later API page fails", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(list()))
      .mockResolvedValueOnce(Response.json({}, { status: 503 }));
    const ctx = context(fetcher);
    const interaction = command();
    await run(interaction, ctx);
    const page = button(next(interaction.followUp.mock.calls[0]?.[0]));
    await run(page, ctx);
    expect(page.editReply).not.toHaveBeenCalled();
    expect(page.followUp.mock.calls[0]?.[0]).toHaveProperty("content");
    expect(page.followUp.mock.calls[0]?.[0]).toHaveProperty(
      "flags",
      MessageFlags.Ephemeral,
    );
  });
  it("keeps the error private if publishing the public reply fails", async () => {
    const interaction = command();
    interaction.followUp.mockRejectedValue(new Error("Missing access"));
    await run(
      interaction,
      context(() => Promise.resolve(Response.json(list()))),
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
