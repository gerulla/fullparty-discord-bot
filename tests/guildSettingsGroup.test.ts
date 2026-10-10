import {
  PermissionFlagsBits,
  PermissionsBitField,
  type ChatInputCommandInteraction,
  type Client,
} from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BotContext } from "../src/bot/context.js";
import { linkCommand } from "../src/commands/link.js";
import { updateGuildSettingsFromFullparty } from "../src/guildIntegration/settingsService.js";
import { SqliteGuildSettingsStore } from "../src/guildSettings/store.js";
import { guildSettingsUpdatedDataSchema } from "../src/http/eventSchemas.js";
import { LatestPayloadStore } from "../src/payloads/latestPayloadStore.js";

describe("linked group settings", () => {
  const stores: SqliteGuildSettingsStore[] = [];
  afterEach(() => {
    stores.splice(0).forEach((store) => {
      store.close();
    });
  });

  it.each([
    { data: { group: { slug: "example-raiders" } } },
    { data: { group_slug: " example-raiders " } },
    { group: { slug: "example-raiders" } },
    { group_slug: "example-raiders" },
  ])("saves the group slug from a successful guild link: %j", async (response) => {
    const { context, store } = createFixture(response);
    await linkCommand.execute(createInteraction(), context);
    await expect(store.get("guild-id")).resolves.toMatchObject({
      groupSlug: "example-raiders",
      linkedAt: expect.any(String) as string,
    });
  });

  it("clears an old group's slug if a new link has no group metadata", async () => {
    const { context, store } = createFixture({ linked: true });
    await store.update("guild-id", { groupSlug: "previous-group" });
    await linkCommand.execute(createInteraction(), context);
    await expect(store.get("guild-id")).resolves.not.toHaveProperty("groupSlug");
  });

  it("hydrates existing links from settings events, preserves omitted slugs, and clears explicit null", async () => {
    const { context, store } = createFixture({});
    const apply = (extra: Record<string, unknown>) =>
      updateGuildSettingsFromFullparty(
        { client: {} as Client, context },
        guildSettingsUpdatedDataSchema.parse({
          discord_guild_id: "guild-id",
          settings: {},
          ...extra,
        }),
      );
    await store.update("guild-id", { linkedAt: "2026-06-01T10:00:00.000Z" });
    await apply({ group_slug: " example-raiders " });
    await apply({ settings: { sync_discord_names_to_ff14: true } });
    await expect(store.get("guild-id")).resolves.toMatchObject({
      groupSlug: "example-raiders",
      linkedAt: "2026-06-01T10:00:00.000Z",
      syncDiscordNamesToFf14: true,
    });
    await apply({ group_slug: null });
    await expect(store.get("guild-id")).resolves.not.toHaveProperty("groupSlug");
  });

  function createFixture(response: unknown) {
    const store = new SqliteGuildSettingsStore(":memory:");
    stores.push(store);
    const context = {
      fullparty: { linkDiscordGuild: vi.fn().mockResolvedValue(response) },
      fullpartyWebBaseUrl: "https://fullparty.gg",
      guildSettings: store,
      payloads: new LatestPayloadStore(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as unknown as BotContext;
    return { context, store };
  }

  function createInteraction(): ChatInputCommandInteraction {
    return {
      appPermissions: { bitfield: 0n },
      memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild),
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      guild: { iconURL: () => null, name: "Example Raiders" },
      guildId: "guild-id",
      inGuild: () => true,
      options: { getString: () => "example-link-token" },
      user: { id: "123456789012345678" },
    } as unknown as ChatInputCommandInteraction;
  }
});
