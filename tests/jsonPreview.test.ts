import { MessageFlags, type Message, type Interaction } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import type { BotContext } from "../src/bot/context.js";
import { handleJsonPreviewMessage, parseJsonPreview } from "../src/dev/jsonPreview.js";
import { createInteractionHandler } from "../src/interactions/handleInteraction.js";
import { FullpartyApiClient } from "../src/fullparty/client.js";
import { LatestPayloadStore } from "../src/payloads/latestPayloadStore.js";

function context(): BotContext {
  return {
    developmentJsonEnabled: true,
    payloadCommandAllowedUserId: "owner",
    fullparty: new FullpartyApiClient({ baseUrl: "https://fullparty.test/api" }),
    fullpartyWebBaseUrl: "https://fullparty.test",
    guildSettings: {
      get: (guildId) => Promise.resolve({ guildId, syncDiscordNamesToFf14: false }),
      update: (guildId) => Promise.resolve({ guildId, syncDiscordNamesToFf14: false }),
    },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    payloads: new LatestPayloadStore(),
  };
}
function message(
  content: string,
  options: { bot?: boolean; guild?: boolean; userId?: string } = {},
) {
  const post = vi.fn().mockResolvedValue({});
  const reply = vi.fn().mockResolvedValue({});
  return {
    post,
    reply,
    message: {
      content,
      author: { id: options.userId ?? "owner", bot: options.bot ?? false },
      channelId: "dm-channel",
      inGuild: () => options.guild ?? false,
      client: { rest: { post } },
      reply,
    } as unknown as Message,
  };
}

describe("development !json previews", () => {
  it("posts V1 embeds in the invoking DM, ignoring destination and mention overrides", async () => {
    const m = message(
      '!json {"content":"<@123>","embeds":[{"title":"Run confirmed","color":0}],"channel_id":"another-channel","allowed_mentions":{"parse":["everyone"]},"flags":64}',
    );
    expect(await handleJsonPreviewMessage(m.message, context())).toBe(true);
    expect(m.post).toHaveBeenCalledExactlyOnceWith("/channels/dm-channel/messages", {
      body: {
        content: "<@123>",
        embeds: [{ title: "Run confirmed", color: 0 }],
        flags: 0,
        allowed_mentions: { parse: [], replied_user: false },
      },
    });
    expect(m.reply).not.toHaveBeenCalled();
  });

  it("accepts fenced editor JSON, infers V2, and isolates controls from live bot handlers", () => {
    const payload = parseJsonPreview(
      '```json\n{"components":[{"type":17,"components":[{"type":10,"content":"# Run confirmed"},{"type":1,"components":[{"type":2,"style":1,"label":"Apply","custom_id":"setup:dangerous"}]}]}]}\n```',
    );
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(JSON.stringify(payload)).not.toContain("setup:dangerous");
    expect(JSON.stringify(payload)).toContain("json-preview:");
    expect(JSON.stringify(payload)).toContain("# Run confirmed");
  });

  it("preserves link buttons and saved-version message wrappers", () => {
    const payload = parseJsonPreview(
      JSON.stringify({
        name: "Design",
        message: {
          components: [
            {
              type: 1,
              components: [
                { type: 2, style: 5, label: "Open", url: "https://fullparty.gg" },
              ],
            },
          ],
        },
      }),
    );
    expect(JSON.stringify(payload)).toContain("https://fullparty.gg");
    expect(payload.flags).toBe(0);
  });

  it("omits blank gallery and thumbnail descriptions before posting a nested V2 preview", async () => {
    const gallery = {
      type: 12,
      items: [
        {
          media: { url: "https://fullparty.gg/prereqimages/chaotic.webp" },
          description: "",
        },
        { media: { url: "https://example.com/banner.png" }, description: "  Banner  " },
      ],
    };
    const thumbnail = {
      type: 11,
      media: { url: "https://example.com/host.png" },
      description: " \n ",
    };
    const section = {
      type: 9,
      components: [{ type: 10, content: "# Cloud Of Darkness - Run2 Electric Boogaloo" }],
      accessory: thumbnail,
    };
    const m = message(
      "!json " +
        JSON.stringify({
          flags: 32768,
          components: [
            {
              type: 17,
              accent_color: 16733011,
              spoiler: false,
              components: [gallery, section],
            },
          ],
        }),
    );
    await handleJsonPreviewMessage(m.message, context());
    expect(m.post).toHaveBeenCalledExactlyOnceWith("/channels/dm-channel/messages", {
      body: {
        flags: 32768,
        allowed_mentions: { parse: [], replied_user: false },
        components: [
          {
            type: 17,
            accent_color: 16733011,
            spoiler: false,
            components: [
              {
                ...gallery,
                items: [{ media: gallery.items[0]?.media }, gallery.items[1]],
              },
              { ...section, accessory: { type: 11, media: thumbnail.media } },
            ],
          },
        ],
      },
    });
    expect(m.reply).not.toHaveBeenCalled();
  });

  it("leaves nonempty media descriptions and unrelated embed fields unchanged", () => {
    const description = "x".repeat(1024);
    const components = [
      { type: 12, items: [{ media: { url: "https://example.com/a.png" }, description }] },
    ];
    expect(parseJsonPreview(JSON.stringify({ components })).components).toEqual(
      components,
    );
    const embeds = [{ title: "Example", description: "", color: 0 }];
    expect(parseJsonPreview(JSON.stringify({ embeds })).embeds).toEqual(embeds);
  });

  it.each([
    ['{"', "valid JSON"],
    ["[]", "message object"],
    ["{}", "empty"],
    ['{"files":["C:/private/file.txt"]}', "cannot upload attachments"],
    ['{"embeds":[{"image":{"url":"attachment://image.png"}}]}', "https://"],
    [
      '{"flags":32768,"content":"Legacy","components":[{"type":10,"content":"New"}]}',
      "cannot include traditional",
    ],
  ])(
    "explains unsupported or invalid input without contacting Discord: %s",
    async (input, explanation) => {
      const m = message("!json " + input);
      await handleJsonPreviewMessage(m.message, context());
      expect(m.post).not.toHaveBeenCalled();
      expect(m.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining(explanation) as string,
        }),
      );
    },
  );

  it("ignores disabled instances, guild messages, bots and unrelated prefixes", async () => {
    const ctx = context();
    ctx.developmentJsonEnabled = false;
    const disabled = message('!json {"content":"Hello"}');
    expect(await handleJsonPreviewMessage(disabled.message, ctx)).toBe(false);
    expect(disabled.post).not.toHaveBeenCalled();
    expect(disabled.reply).not.toHaveBeenCalled();
    for (const m of [
      message("!json {}", { guild: true }),
      message("!json {}", { bot: true }),
      message("!jsonabc {}"),
      message("!token"),
    ]) {
      await handleJsonPreviewMessage(m.message, context());
      expect(m.post).not.toHaveBeenCalled();
      expect(m.reply).not.toHaveBeenCalled();
    }
  });

  it("requires the configured owner and shows usage for an empty command", async () => {
    for (const owner of ["different-owner", undefined]) {
      const ctx = context();
      ctx.payloadCommandAllowedUserId = owner;
      const m = message('!json {"content":"Hello"}');
      await handleJsonPreviewMessage(m.message, ctx);
      expect(m.post).not.toHaveBeenCalled();
      expect(m.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("configured bot owner") as string,
        }),
      );
    }
    const m = message("!json");
    await handleJsonPreviewMessage(m.message, context());
    expect(m.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("Hello!") as string }),
    );
  });

  it("returns Discord's form diagnostics without reporting a bot outage", async () => {
    const m = message('!json {"embeds":[{"title":"Invalid"}]}');
    m.post.mockRejectedValue(
      Object.assign(new Error("Invalid Form Body: embeds[0].color"), { code: 50035 }),
    );
    await handleJsonPreviewMessage(m.message, context());
    expect(m.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("embeds[0].color") as string,
      }),
    );
  });

  it("preview buttons and all select menus return preview feedback", async () => {
    for (const isButton of [true, false]) {
      const reply = vi.fn().mockResolvedValue({});
      await createInteractionHandler(context())({
        isChatInputCommand: () => false,
        isButton: () => isButton,
        isAnySelectMenu: () => !isButton,
        customId: "json-preview:test:1",
        user: { id: "owner" },
        reply,
      } as unknown as Interaction);
      expect(reply).toHaveBeenCalledWith({
        content: "This is a JSON preview. The control does not perform a bot action.",
        flags: MessageFlags.Ephemeral,
      });
    }
  });
});
