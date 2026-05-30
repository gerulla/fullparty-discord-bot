import {
  type ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  PermissionsBitField,
} from "discord.js";
import { describe, expect, it } from "vitest";

import type { BotContext } from "../src/bot/context.js";
import { applicationsCommand } from "../src/commands/applications.js";
import { clearRoleCommand } from "../src/commands/clearRole.js";
import { faqCommand } from "../src/commands/faq.js";
import { fullpartyCommand } from "../src/commands/fullparty.js";
import { helpCommand } from "../src/commands/help.js";
import { linkCommand } from "../src/commands/link.js";
import { payloadCommand } from "../src/commands/payload.js";
import { pingCommand } from "../src/commands/ping.js";
import { runsCommand } from "../src/commands/runs.js";
import { FullpartyApiClient } from "../src/fullparty/client.js";
import { LatestPayloadStore } from "../src/payloads/latestPayloadStore.js";

describe("command execution", () => {
  it("replies to ping", async () => {
    const reply = createAsyncRecorder();

    await pingCommand.execute(
      {
        reply: reply.fn,
      } as unknown as ChatInputCommandInteraction,
      createContext(),
    );

    expect(reply.calls).toEqual([["Pong."]]);
  });

  it("checks Fullparty API status", async () => {
    const deferReply = createAsyncRecorder();
    const editReply = createAsyncRecorder();

    await fullpartyCommand.execute(
      {
        deferReply: deferReply.fn,
        editReply: editReply.fn,
        options: {
          getSubcommand: () => "status",
        },
      } as unknown as ChatInputCommandInteraction,
      createContext(),
    );

    expect(deferReply.calls).toEqual([[{ flags: MessageFlags.Ephemeral }]]);
    expect(editReply.calls).toEqual([["Fullparty API status: ok (1.0.0)"]]);
  });

  it("handles unknown Fullparty subcommands", async () => {
    const reply = createAsyncRecorder();

    await fullpartyCommand.execute(
      {
        options: {
          getSubcommand: () => "unknown",
        },
        reply: reply.fn,
      } as unknown as ChatInputCommandInteraction,
      createContext(),
    );

    expect(reply.calls).toEqual([
      [
        {
          content: "Unknown Fullparty command.",
          flags: MessageFlags.Ephemeral,
        },
      ],
    ]);
  });

  it("shows help in DMs", async () => {
    const reply = createAsyncRecorder();

    await helpCommand.execute(
      {
        inGuild: () => false,
        reply: reply.fn,
      } as unknown as ChatInputCommandInteraction,
      createContext(),
    );

    expect(reply.calls).toEqual([
      [
        {
          content: expect.stringContaining(
            "Most FullParty commands need your Discord account linked first.",
          ) as string,
        },
      ],
    ]);
    expect(reply.calls[0]?.[0]).toMatchObject({
      content: expect.stringContaining("`/runs`") as string,
    });
    expect(reply.calls[0]?.[0]).toMatchObject({
      content: expect.stringContaining("`/faq`") as string,
    });
    expect(reply.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        content: expect.not.stringContaining("`/payload`") as string,
      }),
    );
  });

  it("shows the FullParty setup FAQ ephemerally in guilds", async () => {
    const reply = createAsyncRecorder();

    await faqCommand.execute(
      {
        inGuild: () => true,
        reply: reply.fn,
      } as unknown as ChatInputCommandInteraction,
      createContext(),
    );

    expect(reply.calls).toHaveLength(1);
    expect(reply.calls[0]?.[0]).toMatchObject({
      content: expect.stringContaining("**Template Role**") as string,
      flags: MessageFlags.Ephemeral,
    });
    expect(reply.calls[0]?.[0]).toMatchObject({
      content: expect.stringContaining("**Bot Moderator Role**") as string,
    });
  });

  it("shows help ephemerally in guilds", async () => {
    const reply = createAsyncRecorder();

    await helpCommand.execute(
      {
        inGuild: () => true,
        reply: reply.fn,
      } as unknown as ChatInputCommandInteraction,
      createContext(),
    );

    expect(reply.calls).toHaveLength(1);
    expect(reply.calls[0]?.[0]).toMatchObject({
      content: expect.stringContaining("`/setup`") as string,
      flags: MessageFlags.Ephemeral,
    });
  });

  it("clears a selected guild role", async () => {
    const deferReply = createAsyncRecorder();
    const editReply = createAsyncRecorder();
    const deletedReasons: string[] = [];
    const markedRoleIds: string[] = [];
    const runRole = {
      delete: (reason?: string) => {
        deletedReasons.push(reason ?? "");
        return Promise.resolve({});
      },
      id: "run-role-id",
      managed: false,
      name: "FullParty: Cloud of Darkness 21:00 UTC",
    };
    const botHighestRole = {
      comparePositionTo: () => 1,
      delete: () => Promise.resolve({}),
      id: "bot-role-id",
      name: "FullParty Bot",
    };
    const context: BotContext = {
      ...createContext(),
      guildSettings: {
        get: (guildId) =>
          Promise.resolve({
            botModeratorRoleId: "bot-moderator-role-id",
            guildId,
            syncDiscordNamesToFf14: false,
          }),
        update: (guildId) => Promise.resolve({ guildId, syncDiscordNamesToFf14: false }),
      },
      guildRunRoles: {
        get: () => Promise.resolve(undefined),
        markDeleted: () => Promise.resolve(),
        markDeletedByRole: (_guildId, roleId) => {
          markedRoleIds.push(roleId);
          return Promise.resolve();
        },
        upsert: (mapping) => Promise.resolve(mapping),
      },
    };

    await clearRoleCommand.execute(
      {
        appPermissions: new PermissionsBitField(PermissionFlagsBits.ManageRoles),
        deferReply: deferReply.fn,
        editReply: editReply.fn,
        guild: {
          members: {
            me: {
              roles: {
                highest: botHighestRole,
              },
            },
          },
          roles: {
            cache: {
              get: () => runRole,
            },
            fetch: () => Promise.resolve(runRole),
          },
        },
        guildId: "guild-id",
        inGuild: () => true,
        member: {
          roles: ["bot-moderator-role-id"],
        },
        memberPermissions: new PermissionsBitField(0n),
        options: {
          getRole: () => ({ id: "run-role-id" }),
        },
        user: {
          id: "moderator-id",
        },
      } as unknown as ChatInputCommandInteraction,
      context,
    );

    expect(deferReply.calls).toEqual([[{ flags: MessageFlags.Ephemeral }]]);
    expect(deletedReasons).toEqual([
      "FullParty manual clearrole by Discord user moderator-id.",
    ]);
    expect(markedRoleIds).toEqual(["run-role-id"]);
    expect(editReply.calls).toEqual([
      [
        {
          content:
            "✅ Cleared `FullParty: Cloud of Darkness 21:00 UTC`. Discord will remove that role from all members automatically.",
        },
      ],
    ]);
  });

  it("blocks clearrole when the selected role is above the bot", async () => {
    const deferReply = createAsyncRecorder();
    const editReply = createAsyncRecorder();
    const deletedReasons: string[] = [];
    const runRole = {
      delete: (reason?: string) => {
        deletedReasons.push(reason ?? "");
        return Promise.resolve({});
      },
      id: "run-role-id",
      managed: false,
      name: "FullParty: Cloud of Darkness 21:00 UTC",
    };
    const botHighestRole = {
      comparePositionTo: () => 0,
      delete: () => Promise.resolve({}),
      id: "bot-role-id",
      name: "FullParty Bot",
    };

    await clearRoleCommand.execute(
      {
        appPermissions: new PermissionsBitField(PermissionFlagsBits.ManageRoles),
        deferReply: deferReply.fn,
        editReply: editReply.fn,
        guild: {
          members: {
            me: {
              roles: {
                highest: botHighestRole,
              },
            },
          },
          roles: {
            cache: {
              get: () => runRole,
            },
            fetch: () => Promise.resolve(runRole),
          },
        },
        guildId: "guild-id",
        inGuild: () => true,
        memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild),
        options: {
          getRole: () => ({ id: "run-role-id" }),
        },
        user: {
          id: "moderator-id",
        },
      } as unknown as ChatInputCommandInteraction,
      createContext(),
    );

    expect(deferReply.calls).toEqual([[{ flags: MessageFlags.Ephemeral }]]);
    expect(deletedReasons).toEqual([]);
    expect(editReply.calls).toEqual([
      [
        {
          content:
            "`FullParty: Cloud of Darkness 21:00 UTC` is at or above my highest role. Move the bot role above it in Discord role settings, then try again.",
        },
      ],
    ]);
  });

  it("blocks clearrole when the user lacks Manage Server and the bot moderator role", async () => {
    const reply = createAsyncRecorder();
    const context: BotContext = {
      ...createContext(),
      guildSettings: {
        get: (guildId) =>
          Promise.resolve({
            botModeratorRoleId: "bot-moderator-role-id",
            guildId,
            syncDiscordNamesToFf14: false,
          }),
        update: (guildId) => Promise.resolve({ guildId, syncDiscordNamesToFf14: false }),
      },
    };

    await clearRoleCommand.execute(
      {
        guildId: "guild-id",
        inGuild: () => true,
        member: {
          roles: ["some-other-role-id"],
        },
        memberPermissions: new PermissionsBitField(0n),
        reply: reply.fn,
      } as unknown as ChatInputCommandInteraction,
      context,
    );

    expect(reply.calls).toEqual([
      [
        {
          content:
            "You need Manage Server or the configured FullParty bot moderator role to use this command.",
          flags: MessageFlags.Ephemeral,
        },
      ],
    ]);
  });

  it("shows FullParty applications for the invoking Discord user", async () => {
    const deferReply = createAsyncRecorder();
    const editReply = createAsyncRecorder();
    const applicationsResponse = {
      data: [
        {
          activity: {
            datacenter: "Chaos",
            display_name: "Forked Tower of Blood",
            group: {
              name: "asd",
              slug: "asdd",
            },
            intensity: "casual",
            run_style: "progression",
            starts_at: "2026-06-01T22:00:00+00:00",
          },
          character: {
            datacenter: "Light",
            name: "Giki Chomusuke",
            world: "Lich",
          },
          status: "pending",
          submitted_at: "2026-05-30T01:17:10+00:00",
          urls: {
            overview: "/en/groups/asdd/activities/6934",
          },
        },
      ],
    };
    const fetcher = createJsonFetcher({
      ...applicationsResponse,
    });
    const context = createContext(fetcher);

    await applicationsCommand.execute(
      {
        deferReply: deferReply.fn,
        editReply: editReply.fn,
        user: {
          id: "123456789012345678",
        },
      } as unknown as ChatInputCommandInteraction,
      context,
    );

    expect(deferReply.calls).toEqual([[]]);
    expect(editReply.calls).toEqual([
      [
        {
          content: "Found 1 FullParty application.",
          embeds: [
            {
              color: 0x3b82f6,
              description: "Application for Forked Tower of Blood in asd.",
              fields: [
                {
                  inline: true,
                  name: "Character",
                  value: "Giki Chomusuke (Lich, Light)",
                },
                {
                  inline: true,
                  name: "Status",
                  value: "Pending",
                },
                {
                  inline: true,
                  name: "Starts",
                  value: "<t:1780351200:F> (<t:1780351200:R>)",
                },
                {
                  inline: true,
                  name: "Submitted",
                  value: "<t:1780103830:F> (<t:1780103830:R>)",
                },
                {
                  inline: true,
                  name: "Datacenter",
                  value: "Chaos",
                },
                {
                  inline: true,
                  name: "Style",
                  value: "Progression",
                },
                {
                  inline: true,
                  name: "Intensity",
                  value: "Casual",
                },
              ],
              footer: {
                text: "FullParty - Applications",
              },
              title: "Forked Tower of Blood",
              url: "http://fullparty.test/en/groups/asdd/activities/6934",
            },
          ],
        },
      ],
    ]);
    expect(context.payloads.get()).toMatchObject({
      payload: {
        command: "applications",
        discord_user_id: "123456789012345678",
        ok: true,
        response: applicationsResponse,
        source: "fullparty.api",
      },
      source: "FullParty /applications API response",
    });
  });

  it("shows FullParty upcoming runs for the invoking Discord user", async () => {
    const deferReply = createAsyncRecorder();
    const editReply = createAsyncRecorder();
    const runsResponse = {
      data: [
        {
          datacenter: "Chaos",
          display_name: "AAC Cruiserweight M1 (Savage)",
          group: {
            name: "asd",
            slug: "asdd",
          },
          intensity: "casual",
          run_style: "progression",
          starts_at: "2026-05-31T20:00:00+00:00",
          status: "assigned",
          user_context: {
            slot: {
              character: {
                datacenter: "Light",
                name: "Giki Chomusuke",
                world: "Lich",
              },
              group_label: {
                en: "Party",
              },
              slot_label: {
                en: "Party 2",
              },
            },
          },
          urls: {
            overview: "/en/groups/asdd/activities/6932",
          },
        },
      ],
    };
    const fetcher = createJsonFetcher(runsResponse);
    const context = createContext(fetcher);

    await runsCommand.execute(
      {
        deferReply: deferReply.fn,
        editReply: editReply.fn,
        user: {
          id: "123456789012345678",
        },
      } as unknown as ChatInputCommandInteraction,
      context,
    );

    expect(deferReply.calls).toEqual([[]]);
    expect(editReply.calls).toEqual([
      [
        {
          content: "Found 1 FullParty upcoming run.",
          embeds: [
            {
              color: 0xf59e0b,
              description: "AAC Cruiserweight M1 (Savage) in asd.",
              fields: [
                {
                  inline: true,
                  name: "Starts",
                  value: "<t:1780257600:F> (<t:1780257600:R>)",
                },
                {
                  inline: true,
                  name: "Status",
                  value: "Assigned",
                },
                {
                  inline: true,
                  name: "Character",
                  value: "Giki Chomusuke (Lich, Light)",
                },
                {
                  inline: true,
                  name: "Party",
                  value: "Party",
                },
                {
                  inline: true,
                  name: "Datacenter",
                  value: "Chaos",
                },
                {
                  inline: true,
                  name: "Style",
                  value: "Progression",
                },
                {
                  inline: true,
                  name: "Intensity",
                  value: "Casual",
                },
              ],
              footer: {
                text: "FullParty - Upcoming Runs",
              },
              title: "AAC Cruiserweight M1 (Savage)",
              url: "http://fullparty.test/en/groups/asdd/activities/6932",
            },
          ],
        },
      ],
    ]);
    expect(context.payloads.get()).toMatchObject({
      payload: {
        command: "runs",
        discord_user_id: "123456789012345678",
        ok: true,
        response: runsResponse,
        source: "fullparty.api",
      },
      source: "FullParty /runs API response",
    });
  });

  it("links the invoking Discord user to FullParty", async () => {
    const deferReply = createAsyncRecorder();
    const editReply = createAsyncRecorder();
    const calls: FetchCall[] = [];
    const linkResponse = {
      linked: true,
    };
    const context = createContext(createRecordingJsonFetcher(linkResponse, calls));

    await linkCommand.execute(
      {
        deferReply: deferReply.fn,
        editReply: editReply.fn,
        inGuild: () => false,
        options: {
          getString: () => " ABCD1234-EFGH5678 ",
        },
        user: {
          displayAvatarURL: () => "https://cdn.discordapp.com/avatar.png",
          globalName: "Giki",
          id: "123456789012345678",
          username: "yenpress",
        },
      } as unknown as ChatInputCommandInteraction,
      context,
    );

    expect(deferReply.calls).toEqual([[]]);
    expect(editReply.calls).toEqual([
      [
        {
          content: "Validating code ABCD1234-EFGH5678 with the FullParty server...",
        },
      ],
      [
        {
          content:
            "✅ Your Discord account is now linked to FullParty. You can receive FullParty updates here and use the Discord integration features tied to your account.",
        },
      ],
    ]);
    expect(calls).toHaveLength(1);
    expect(parseJsonRequestBody(calls[0])).toEqual({
      avatar_url: "https://cdn.discordapp.com/avatar.png",
      discord_user_id: "123456789012345678",
      global_name: "Giki",
      token: "ABCD1234-EFGH5678",
      username: "yenpress",
    });
    expect(context.payloads.get()).toMatchObject({
      payload: {
        command: "link",
        discord_user_id: "123456789012345678",
        ok: true,
        response: linkResponse,
        source: "fullparty.api",
      },
      source: "FullParty /link API response",
    });
  });

  it("links the invoking Discord guild to FullParty", async () => {
    const deferReply = createAsyncRecorder();
    const editReply = createAsyncRecorder();
    const calls: FetchCall[] = [];
    const linkResponse = {
      linked: true,
    };
    const context = createContext(createRecordingJsonFetcher(linkResponse, calls));

    await linkCommand.execute(
      {
        appPermissions: {
          bitfield: 123456n,
        },
        deferReply: deferReply.fn,
        editReply: editReply.fn,
        guild: {
          iconURL: () => "https://cdn.discordapp.com/icons/server.png",
          name: "Raid Server",
        },
        guildId: "1379217636696789022",
        inGuild: () => true,
        options: {
          getString: () => " ABCD1234-EFGH5678 ",
        },
        user: {
          id: "123456789012345678",
        },
      } as unknown as ChatInputCommandInteraction,
      context,
    );

    expect(deferReply.calls).toEqual([[{ flags: MessageFlags.Ephemeral }]]);
    expect(editReply.calls).toEqual([
      [
        {
          content: "Validating code ABCD1234-EFGH5678 with the FullParty server...",
        },
      ],
      [
        {
          content:
            "✅ This Discord server is now linked to FullParty. FullParty can now use the server-side integration features configured for this guild.",
        },
      ],
    ]);
    expect(calls).toHaveLength(1);
    expect(fetchInputToUrl(calls[0]?.input)).toBe(
      "http://fullparty.test/api/integrations/discord-guilds/link",
    );
    expect(parseJsonRequestBody(calls[0])).toEqual({
      discord_guild_id: "1379217636696789022",
      icon_url: "https://cdn.discordapp.com/icons/server.png",
      name: "Raid Server",
      permissions: "123456",
      token: "ABCD1234-EFGH5678",
    });
    expect(context.payloads.get()).toMatchObject({
      payload: {
        command: "link",
        discord_guild_id: "1379217636696789022",
        ok: true,
        response: linkResponse,
        source: "fullparty.api",
      },
      source: "FullParty /link API response",
    });
  });

  it("links a Discord guild without an icon to FullParty", async () => {
    const deferReply = createAsyncRecorder();
    const editReply = createAsyncRecorder();
    const calls: FetchCall[] = [];
    const context = createContext(createRecordingJsonFetcher({ linked: true }, calls));

    await linkCommand.execute(
      {
        appPermissions: {
          bitfield: 7336347924769856n,
        },
        deferReply: deferReply.fn,
        editReply: editReply.fn,
        guild: {
          iconURL: () => null,
          name: "Raid Server",
        },
        guildId: "1379217636696789022",
        inGuild: () => true,
        options: {
          getString: () => "JHGC7JJQ-TXEOUHAR",
        },
        user: {
          id: "123456789012345678",
        },
      } as unknown as ChatInputCommandInteraction,
      context,
    );

    expect(deferReply.calls).toEqual([[{ flags: MessageFlags.Ephemeral }]]);
    expect(calls).toHaveLength(1);
    expect(parseJsonRequestBody(calls[0])).toEqual({
      discord_guild_id: "1379217636696789022",
      icon_url: null,
      name: "Raid Server",
      permissions: "7336347924769856",
      token: "JHGC7JJQ-TXEOUHAR",
    });
  });

  it("explains how to link a user when no DM token is provided", async () => {
    const deferReply = createAsyncRecorder();
    const editReply = createAsyncRecorder();
    const calls: FetchCall[] = [];
    const context = createContext(createRecordingJsonFetcher({}, calls));

    await linkCommand.execute(
      {
        deferReply: deferReply.fn,
        editReply: editReply.fn,
        inGuild: () => false,
        options: {
          getString: () => null,
        },
        user: {
          id: "123456789012345678",
        },
      } as unknown as ChatInputCommandInteraction,
      context,
    );

    expect(deferReply.calls).toEqual([[]]);
    expect(editReply.calls).toEqual([
      [
        {
          content:
            "I need a FullParty Discord link token to connect your account.\n\nGo to http://fullparty.test, open your user settings, and generate a Discord link code.\n\nThen come back to this DM and run `/link token:<code>`.",
        },
      ],
    ]);
    expect(calls).toEqual([]);
  });

  it("explains how to link a guild when no guild token is provided", async () => {
    const deferReply = createAsyncRecorder();
    const editReply = createAsyncRecorder();
    const calls: FetchCall[] = [];
    const context = createContext(createRecordingJsonFetcher({}, calls));

    await linkCommand.execute(
      {
        deferReply: deferReply.fn,
        editReply: editReply.fn,
        guildId: "1379217636696789022",
        inGuild: () => true,
        options: {
          getString: () => "",
        },
        user: {
          id: "123456789012345678",
        },
      } as unknown as ChatInputCommandInteraction,
      context,
    );

    expect(deferReply.calls).toEqual([[{ flags: MessageFlags.Ephemeral }]]);
    expect(editReply.calls).toEqual([
      [
        {
          content:
            "I need a FullParty Discord server link token to connect this server.\n\nGo to http://fullparty.test, create or open the FullParty group you want to connect, then follow the Discord linking process for that group.\n\nOnce FullParty gives you a code, come back to this server and run `/link token:<code>`.",
        },
      ],
    ]);
    expect(calls).toEqual([]);
  });

  it("shows a useful link error when the token is invalid", async () => {
    const deferReply = createAsyncRecorder();
    const editReply = createAsyncRecorder();
    const context = createContext(
      createJsonFetcher(
        {
          message: "Invalid link token.",
        },
        422,
      ),
    );

    await linkCommand.execute(
      {
        deferReply: deferReply.fn,
        editReply: editReply.fn,
        inGuild: () => false,
        options: {
          getString: () => "BADTOKEN",
        },
        user: {
          displayAvatarURL: () => "https://cdn.discordapp.com/avatar.png",
          globalName: null,
          id: "123456789012345678",
          username: "yenpress",
        },
      } as unknown as ChatInputCommandInteraction,
      context,
    );

    expect(deferReply.calls).toEqual([[]]);
    expect(editReply.calls).toEqual([
      [
        {
          content: "Validating code BADTOKEN with the FullParty server...",
        },
      ],
      [
        "That link token is invalid or expired. Please generate a new Discord link token from FullParty and try again.",
      ],
    ]);
    expect(context.payloads.get()).toMatchObject({
      payload: {
        command: "link",
        discord_user_id: "123456789012345678",
        error: {
          body: {
            message: "Invalid link token.",
          },
          status: 422,
        },
        ok: false,
        source: "fullparty.api",
      },
      source: "FullParty /link API error",
    });
  });

  it("shows a useful guild link error when the integration token lacks guild scope", async () => {
    const deferReply = createAsyncRecorder();
    const editReply = createAsyncRecorder();
    const context = createContext(
      createJsonFetcher(
        {
          message: "This integration token requires guilds:write.",
        },
        403,
      ),
    );

    await linkCommand.execute(
      {
        appPermissions: {
          bitfield: 7336347924769856n,
        },
        deferReply: deferReply.fn,
        editReply: editReply.fn,
        guild: {
          iconURL: () => "https://cdn.discordapp.com/icons/server.png",
          name: "Raid Server",
        },
        guildId: "1379217636696789022",
        inGuild: () => true,
        options: {
          getString: () => "JHGC7JJQ-TXEOUHAR",
        },
        user: {
          id: "123456789012345678",
        },
      } as unknown as ChatInputCommandInteraction,
      context,
    );

    expect(deferReply.calls).toEqual([[{ flags: MessageFlags.Ephemeral }]]);
    expect(editReply.calls).toEqual([
      [
        {
          content: "Validating code JHGC7JJQ-TXEOUHAR with the FullParty server...",
        },
      ],
      [
        "I could not link this Discord server because the FullParty integration API token is missing or does not include guilds:write. Please let the FullParty team know.",
      ],
    ]);
  });

  it("stores FullParty API errors for payload debugging", async () => {
    const deferReply = createAsyncRecorder();
    const editReply = createAsyncRecorder();
    const context = createContext(
      createJsonFetcher(
        {
          message: "Applications route was not found.",
        },
        404,
      ),
    );

    await expect(
      applicationsCommand.execute(
        {
          deferReply: deferReply.fn,
          editReply: editReply.fn,
          user: {
            id: "123456789012345678",
          },
        } as unknown as ChatInputCommandInteraction,
        context,
      ),
    ).rejects.toMatchObject({
      status: 404,
    });

    expect(deferReply.calls).toEqual([[]]);
    expect(editReply.calls).toEqual([]);
    expect(context.payloads.get()).toMatchObject({
      payload: {
        command: "applications",
        discord_user_id: "123456789012345678",
        error: {
          body: {
            message: "Applications route was not found.",
          },
          status: 404,
        },
        ok: false,
        source: "fullparty.api",
      },
      source: "FullParty /applications API error",
    });
  });

  it("reports when no payload has been captured yet", async () => {
    const reply = createAsyncRecorder();

    await payloadCommand.execute(
      {
        reply: reply.fn,
        user: {
          id: "123456789012345678",
        },
      } as unknown as ChatInputCommandInteraction,
      createContext(),
    );

    expect(reply.calls).toEqual([
      [
        {
          content: "No FullParty payload has been captured yet.",
          flags: MessageFlags.Ephemeral,
        },
      ],
    ]);
  });

  it("blocks payload access for other Discord users", async () => {
    const reply = createAsyncRecorder();

    await payloadCommand.execute(
      {
        reply: reply.fn,
        user: {
          id: "999999999999999999",
        },
      } as unknown as ChatInputCommandInteraction,
      createContext(),
    );

    expect(reply.calls).toEqual([
      [
        {
          content: "You are not allowed to use this debug command.",
          flags: MessageFlags.Ephemeral,
        },
      ],
    ]);
  });

  it("blocks payload access when no allowed user is configured", async () => {
    const reply = createAsyncRecorder();
    const context = createContext();
    context.payloadCommandAllowedUserId = undefined;

    await payloadCommand.execute(
      {
        reply: reply.fn,
        user: {
          id: "123456789012345678",
        },
      } as unknown as ChatInputCommandInteraction,
      context,
    );

    expect(reply.calls).toEqual([
      [
        {
          content: "You are not allowed to use this debug command.",
          flags: MessageFlags.Ephemeral,
        },
      ],
    ]);
  });

  it("returns the most recent payload", async () => {
    const followUp = createAsyncRecorder();
    const reply = createAsyncRecorder();
    const context = createContext();
    context.payloads.set(
      {
        data: {
          hello: "world",
        },
        event: "discord.notification.delivery",
      },
      "FullParty event payload",
    );

    await payloadCommand.execute(
      {
        followUp: followUp.fn,
        reply: reply.fn,
        user: {
          id: "123456789012345678",
        },
      } as unknown as ChatInputCommandInteraction,
      context,
    );

    expect(reply.calls).toEqual([
      [
        {
          content: expect.stringContaining(
            "Most recent FullParty event payload captured at",
          ) as string,
          flags: MessageFlags.Ephemeral,
        },
      ],
    ]);
    expect(followUp.calls).toEqual([
      [
        {
          content: expect.stringContaining('"hello": "world"') as string,
          flags: MessageFlags.Ephemeral,
        },
      ],
    ]);
  });
});

function createContext(fetcher: typeof fetch = createDefaultFetcher()): BotContext {
  return {
    fullparty: new FullpartyApiClient({
      baseUrl: "http://fullparty.test/api",
      fetcher,
    }),
    fullpartyWebBaseUrl: "http://fullparty.test",
    guildSettings: {
      get: (guildId) => Promise.resolve({ guildId, syncDiscordNamesToFf14: false }),
      update: (guildId) => Promise.resolve({ guildId, syncDiscordNamesToFf14: false }),
    },
    logger: {
      debug: () => undefined,
      error: () => undefined,
      info: () => undefined,
      warn: () => undefined,
    },
    payloadCommandAllowedUserId: "123456789012345678",
    payloads: new LatestPayloadStore(),
  };
}

function createDefaultFetcher(): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify({ status: "ok", version: "1.0.0" }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
}

type FetchCall = {
  init?: RequestInit;
  input: Parameters<typeof fetch>[0];
};

function createJsonFetcher(responseBody: unknown, status = 200): typeof fetch {
  return createRecordingJsonFetcher(responseBody, [], status);
}

function createRecordingJsonFetcher(
  responseBody: unknown,
  calls: FetchCall[],
  status = 200,
): typeof fetch {
  return (input, init) => {
    calls.push(init === undefined ? { input } : { input, init });

    return Promise.resolve(
      new Response(JSON.stringify(responseBody), {
        headers: { "content-type": "application/json" },
        status,
      }),
    );
  };
}

function parseJsonRequestBody(call: FetchCall | undefined): unknown {
  const body = call?.init?.body;

  if (typeof body !== "string") {
    throw new Error("Expected request body to be a string.");
  }

  return JSON.parse(body) as unknown;
}

function fetchInputToUrl(input: FetchCall["input"] | undefined): string {
  if (!input) {
    throw new Error("Expected fetch input to be set.");
  }

  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.href;
  }

  return input.url;
}

function createAsyncRecorder(): {
  calls: unknown[][];
  fn: (...args: unknown[]) => Promise<void>;
} {
  const calls: unknown[][] = [];

  return {
    calls,
    fn: (...args) => {
      calls.push(args);
      return Promise.resolve();
    },
  };
}
