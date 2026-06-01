import { ChannelType, PermissionFlagsBits } from "discord.js";
import { describe, expect, it } from "vitest";

import type { BotContext } from "../src/bot/context.js";
import { createDiscordGuildSnapshot } from "../src/guildAutomation/guildSnapshot.js";
import { LatestPayloadStore } from "../src/payloads/latestPayloadStore.js";

describe("createDiscordGuildSnapshot", () => {
  it("captures guild roles, channels, bot permissions, and settings", async () => {
    const snapshot = await createDiscordGuildSnapshot(
      createSnapshotClient(),
      createContext(),
      "guild-id",
    );

    expect(snapshot).toMatchObject({
      available_options: {
        bot_log_channels: [
          expect.objectContaining({
            id: "bot-log-channel-id",
            label: "bot-log",
            usable: true,
          }),
          expect.objectContaining({
            disabled_reason: "Bot cannot send messages in this channel.",
            id: "read-only-channel-id",
            usable: false,
          }),
        ],
        bot_moderator_roles: [
          expect.objectContaining({
            id: "template-role-id",
            label: "Upcoming Raider Template",
            usable: true,
          }),
          expect.objectContaining({
            disabled_reason: "Role is managed by Discord or another integration.",
            id: "managed-role-id",
            usable: false,
          }),
        ],
        run_announcement_channels: [
          expect.objectContaining({
            id: "bot-log-channel-id",
            usable: true,
          }),
          expect.objectContaining({
            id: "read-only-channel-id",
            usable: false,
          }),
        ],
        run_role_template_roles: [
          expect.objectContaining({
            id: "template-role-id",
            usable: true,
          }),
          expect.objectContaining({
            id: "managed-role-id",
            usable: false,
          }),
        ],
      },
      bot_permissions: PermissionFlagsBits.ManageRoles.toString(),
      discord_guild_id: "guild-id",
      icon_url: "https://cdn.discordapp.com/icons/guild-id/icon.png",
      member_count: 42,
      name: "Raid Server",
      owner_id: "owner-id",
      settings: {
        bot_log_channel_id: "bot-log-channel-id",
        bot_moderator_role_id: "bot-moderator-role-id",
        linked_at: "2026-06-01T10:00:00.000Z",
        run_announcement_channel_id: "run-announcement-channel-id",
        run_role_template_id: "template-role-id",
        sync_discord_names_to_ff14: true,
        upcoming_raider_role_id: "template-role-id",
      },
    });
    expect(snapshot.roles).toEqual([
      expect.objectContaining({
        editable_by_bot: true,
        id: "template-role-id",
        name: "Upcoming Raider Template",
        usable_as_run_template: true,
      }),
      expect.objectContaining({
        id: "managed-role-id",
        managed: true,
        usable_as_run_template: false,
      }),
    ]);
    expect(snapshot.channels).toEqual([
      expect.objectContaining({
        id: "bot-log-channel-id",
        name: "bot-log",
        sendable_by_bot: true,
        type: ChannelType.GuildText,
        type_name: "GuildText",
        viewable_by_bot: true,
      }),
      expect.objectContaining({
        id: "read-only-channel-id",
        name: "read-only",
        sendable_by_bot: false,
        viewable_by_bot: true,
      }),
    ]);
  });
});

function createSnapshotClient() {
  return {
    guilds: {
      fetch: () =>
        Promise.resolve({
          channels: {
            fetch: () =>
              Promise.resolve(
                new Map([
                  [
                    "bot-log-channel-id",
                    {
                      id: "bot-log-channel-id",
                      isTextBased: () => true,
                      name: "bot-log",
                      parentId: null,
                      permissionsFor: () => ({
                        has: (permission: bigint) =>
                          permission === PermissionFlagsBits.ViewChannel ||
                          permission === PermissionFlagsBits.SendMessages,
                      }),
                      position: 1,
                      type: ChannelType.GuildText,
                      viewable: true,
                    },
                  ],
                  [
                    "read-only-channel-id",
                    {
                      id: "read-only-channel-id",
                      isTextBased: () => true,
                      name: "read-only",
                      parentId: null,
                      permissionsFor: () => ({
                        has: (permission: bigint) =>
                          permission === PermissionFlagsBits.ViewChannel,
                      }),
                      position: 2,
                      type: ChannelType.GuildText,
                      viewable: true,
                    },
                  ],
                ]),
              ),
          },
          iconURL: () => "https://cdn.discordapp.com/icons/guild-id/icon.png",
          id: "guild-id",
          memberCount: 42,
          members: {
            me: {
              permissions: {
                bitfield: PermissionFlagsBits.ManageRoles,
              },
            },
          },
          name: "Raid Server",
          ownerId: "owner-id",
          roles: {
            fetch: () =>
              Promise.resolve(
                new Map([
                  [
                    "template-role-id",
                    {
                      color: 0x22c55e,
                      colors: {
                        primaryColor: 0x22c55e,
                      },
                      editable: true,
                      hoist: false,
                      id: "template-role-id",
                      managed: false,
                      mentionable: true,
                      name: "Upcoming Raider Template",
                      permissions: {
                        bitfield: 0n,
                      },
                      position: 4,
                    },
                  ],
                  [
                    "managed-role-id",
                    {
                      colors: {
                        primaryColor: 0x5865f2,
                      },
                      editable: false,
                      hoist: false,
                      id: "managed-role-id",
                      managed: true,
                      mentionable: false,
                      name: "Managed Role",
                      permissions: {
                        bitfield: 0n,
                      },
                      position: 3,
                    },
                  ],
                ]),
              ),
          },
        }),
    },
  } as never;
}

function createContext(): BotContext {
  return {
    fullparty: {
      health: () => Promise.resolve({ status: "ok" }),
    } as never,
    fullpartyWebBaseUrl: "https://fullparty.gg",
    guildSettings: {
      get: (guildId) =>
        Promise.resolve({
          botLogChannelId: "bot-log-channel-id",
          botModeratorRoleId: "bot-moderator-role-id",
          guildId,
          linkedAt: "2026-06-01T10:00:00.000Z",
          runAnnouncementChannelId: "run-announcement-channel-id",
          syncDiscordNamesToFf14: true,
          upcomingRaiderRoleId: "template-role-id",
        }),
      update: (guildId) => Promise.resolve({ guildId, syncDiscordNamesToFf14: false }),
    },
    logger: {
      debug: () => undefined,
      error: () => undefined,
      info: () => undefined,
      warn: () => undefined,
    },
    payloads: new LatestPayloadStore(),
  };
}
