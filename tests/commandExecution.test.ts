import {
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  PermissionsBitField,
} from "discord.js";
import { describe, expect, it, vi } from "vitest";

import type { BotContext } from "../src/bot/context.js";
import { applicationsCommand } from "../src/commands/applications.js";
import {
  assignRunRoleCommand,
  debugAssignRunRoleCommand,
} from "../src/commands/assignRunRole.js";
import { clearRoleCommand } from "../src/commands/clearRole.js";
import { faqCommand } from "../src/commands/faq.js";
import { fullpartyCommand } from "../src/commands/fullparty.js";
import { guildRunsCommand } from "../src/commands/guildRuns.js";
import { helpCommand } from "../src/commands/help.js";
import { linkCommand } from "../src/commands/link.js";
import { payloadCommand } from "../src/commands/payload.js";
import { pingCommand } from "../src/commands/ping.js";
import { postRunsCommand } from "../src/commands/postRuns.js";
import { runsCommand } from "../src/commands/runs.js";
import { FullpartyApiClient } from "../src/fullparty/client.js";
import { LatestPayloadStore } from "../src/payloads/latestPayloadStore.js";
import { messageText } from "./helpers/messages.js";

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
    const context = createContext();
    const settingsLookup = vi.spyOn(context.guildSettings, "get");

    await helpCommand.execute(
      {
        inGuild: () => false,
        reply: reply.fn,
      } as unknown as ChatInputCommandInteraction,
      context,
    );

    expect(reply.calls).toHaveLength(1);
    const message = getFirstMessageOptions(reply);
    expect(message).not.toHaveProperty("flags");
    expect(message.content).toContain("**FullParty Help · Direct Messages**");
    expect(message.content).toContain("**DM commands**");
    for (const command of ["/link", "/runs", "/applications", "/faq", "/ping", "/help"]) {
      expect(message.content).toContain(`\`${command}`);
    }
    for (const command of [
      "/info",
      "/setup",
      "/guildruns",
      "/postruns",
      "/assignrunrole",
      "/debugassignrunrole",
      "/clearrole",
      "/rolesync",
      "/payload",
    ]) {
      expect(message.content).not.toContain(`\`${command}`);
    }
    expect(message.content).toContain(
      "http://fullparty.test/auth/discord-app/user/redirect",
    );
    expect(message.content?.length).toBeLessThanOrEqual(2000);
    expect(settingsLookup).not.toHaveBeenCalled();
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

  it.each([
    {
      name: "ordinary member",
      permissions: [],
      member: { roles: [] },
      canModerate: false,
      canManageServer: false,
      canManageRoles: false,
    },
    {
      name: "unrelated role",
      permissions: [],
      member: { roles: ["other-role"] },
      canModerate: false,
      canManageServer: false,
      canManageRoles: false,
    },
    {
      name: "moderator role from API",
      permissions: [],
      member: { roles: ["bot-moderator"] },
      canModerate: true,
      canManageServer: false,
      canManageRoles: false,
    },
    {
      name: "moderator role from cache",
      permissions: [],
      member: { roles: { cache: new Map([["bot-moderator", {}]]) } },
      canModerate: true,
      canManageServer: false,
      canManageRoles: false,
    },
    {
      name: "moderator role from role lookup",
      permissions: [],
      member: { roles: new Set(["bot-moderator"]) },
      canModerate: true,
      canManageServer: false,
      canManageRoles: false,
    },
    {
      name: "Manage Server only",
      permissions: [PermissionFlagsBits.ManageGuild],
      member: { roles: [] },
      canModerate: true,
      canManageServer: true,
      canManageRoles: false,
    },
    {
      name: "Manage Roles only",
      permissions: [PermissionFlagsBits.ManageRoles],
      member: { roles: [] },
      canModerate: false,
      canManageServer: false,
      canManageRoles: true,
    },
    {
      name: "moderator with Manage Roles",
      permissions: [PermissionFlagsBits.ManageRoles],
      member: { roles: ["bot-moderator"] },
      canModerate: true,
      canManageServer: false,
      canManageRoles: true,
    },
    {
      name: "administrator",
      permissions: [PermissionFlagsBits.Administrator],
      member: { roles: [] },
      canModerate: true,
      canManageServer: true,
      canManageRoles: true,
    },
  ])(
    "shows private guild help for $name based on actual command permissions",
    async ({ permissions, member, canModerate, canManageServer, canManageRoles }) => {
      const reply = createAsyncRecorder();
      const deferReply = createAsyncRecorder();
      const editReply = createAsyncRecorder();
      const context = createContext();
      const settingsLookup = vi.fn((guildId: string) => {
        expect(deferReply.calls).toEqual([[{ flags: MessageFlags.Ephemeral }]]);
        return Promise.resolve({
          guildId,
          syncDiscordNamesToFf14: false,
          botModeratorRoleId: "bot-moderator",
        });
      });
      context.guildSettings.get = settingsLookup;

      await helpCommand.execute(
        {
          inGuild: () => true,
          guildId: "guild-id",
          memberPermissions: new PermissionsBitField(permissions),
          member,
          reply: reply.fn,
          deferReply: deferReply.fn,
          editReply: editReply.fn,
        } as unknown as ChatInputCommandInteraction,
        context,
      );

      expect(reply.calls).toEqual([]);
      expect(deferReply.calls).toEqual([[{ flags: MessageFlags.Ephemeral }]]);
      expect(editReply.calls).toHaveLength(1);
      const { content } = getFirstMessageOptions(editReply);
      expect(typeof content).toBe("string");
      expect(content).toContain("**FullParty Help · Server**");
      expect(content).toContain("**Member commands**");
      expect(content?.includes("**Admin commands**")).toBe(
        canModerate || canManageServer || canManageRoles,
      );
      for (const command of ["/info", "/faq", "/ping", "/help"]) {
        expect(content).toContain(`\`${command}`);
      }
      for (const command of [
        "/guildruns",
        "/postruns",
        "/assignrunrole",
        "/debugassignrunrole",
        "/clearrole",
      ]) {
        expect(content?.includes(`\`${command}`)).toBe(canModerate);
      }
      expect(content?.includes("`/setup")).toBe(canManageServer);
      expect(content?.includes("`/link token:")).toBe(canManageServer);
      expect(content?.includes("`/rolesync")).toBe(canManageRoles);
      expect(content).not.toContain("`/runs");
      expect(content).not.toContain("`/applications");
      expect(content).not.toContain("`/payload");
      expect(content?.length).toBeLessThanOrEqual(2000);
      if (canManageServer) {
        expect(settingsLookup).not.toHaveBeenCalled();
      } else {
        expect(settingsLookup).toHaveBeenCalledExactlyOnceWith("guild-id");
      }
    },
  );

  it("lets a configured bot moderator clear a tracked active run role", async () => {
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
        listByGuild: () =>
          Promise.resolve([
            {
              createdAt: "2026-10-10T00:00:00.000Z",
              discordGuildId: "guild-id",
              roleId: "run-role-id",
              roleName: runRole.name,
              runId: 123,
              status: "active",
              templateRoleId: "template-role-id",
              updatedAt: "2026-10-10T00:00:00.000Z",
            },
          ]),
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

  it.each([
    "untracked",
    "different role",
    "different guild",
    "deleted mapping",
    "missing store",
    "missing lookup",
  ])("blocks clearrole for %s, even with Manage Roles", async (scenario) => {
    const deleteRole = createAsyncRecorder();
    const markDeleted = createAsyncRecorder();
    const editReply = createAsyncRecorder();
    const role = {
      delete: deleteRole.fn,
      editable: true,
      id: "run-role-id",
      managed: false,
      name: "Run: Cloud of Darkness 21:00 UTC",
    };
    const context = createContext();
    context.guildRunRoles =
      scenario === "missing store"
        ? undefined
        : {
            get: () => Promise.resolve(undefined),
            ...(scenario === "missing lookup"
              ? {}
              : {
                  listByGuild: () =>
                    Promise.resolve(
                      scenario === "untracked"
                        ? []
                        : [
                            {
                              createdAt: "2026-10-10T00:00:00.000Z",
                              discordGuildId:
                                scenario === "different guild"
                                  ? "other-guild-id"
                                  : "guild-id",
                              roleId:
                                scenario === "different role" ? "other-role-id" : role.id,
                              roleName: role.name,
                              runId: 123,
                              status:
                                scenario === "deleted mapping"
                                  ? ("deleted" as const)
                                  : ("active" as const),
                              templateRoleId: "template-role-id",
                              updatedAt: "2026-10-10T00:00:00.000Z",
                            },
                          ],
                    ),
                }),
            markDeleted: markDeleted.fn,
            markDeletedByRole: markDeleted.fn,
            upsert: (mapping) => Promise.resolve(mapping),
          };

    await clearRoleCommand.execute(
      {
        appPermissions: new PermissionsBitField(PermissionFlagsBits.ManageRoles),
        deferReply: createAsyncRecorder().fn,
        editReply: editReply.fn,
        guild: {
          members: {},
          roles: { cache: new Map([[role.id, role]]) },
        },
        guildId: "guild-id",
        inGuild: () => true,
        memberPermissions: new PermissionsBitField([
          PermissionFlagsBits.ManageGuild,
          PermissionFlagsBits.ManageRoles,
        ]),
        options: { getRole: () => ({ id: role.id }) },
        user: { id: "moderator-id" },
      } as unknown as ChatInputCommandInteraction,
      context,
    );

    expect(deleteRole.calls).toEqual([]);
    expect(markDeleted.calls).toEqual([]);
    expect(editReply.calls).toEqual([
      [
        {
          content:
            "I can only clear an active FullParty run role tracked for this server. That role could not be verified; no roles were deleted.",
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

  it.each([guildRunsCommand, assignRunRoleCommand, debugAssignRunRoleCommand])(
    "uses V2 setup guidance for an unlinked guild in $data.name",
    async (command) => {
      const reply = createAsyncRecorder();
      const calls: FetchCall[] = [];
      await command.execute(
        {
          reply: reply.fn,
          guildId: "guild-id",
          inGuild: () => true,
          memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild),
        } as unknown as ChatInputCommandInteraction,
        createContext(createRecordingJsonFetcher({}, calls)),
      );
      expect(reply.calls).toMatchObject([
        [
          {
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [], repliedUser: false },
            components: [
              { type: 10, content: expect.stringContaining("`/link`") as string },
            ],
          },
        ],
      ]);
      expect(calls).toEqual([]);
    },
  );

  it("uses V2 setup guidance when a guildruns assignment button's guild becomes unlinked", async () => {
    const reply = createAsyncRecorder();
    const calls: FetchCall[] = [];
    await guildRunsCommand.handleComponent?.(
      {
        reply: reply.fn,
        guildId: "guild-id",
        customId: "guildruns:assign:guild-id:moderator-id:25:0:123",
        isButton: () => true,
        user: { id: "moderator-id" },
      } as unknown as ButtonInteraction,
      createContext(createRecordingJsonFetcher({}, calls)),
    );
    expect(reply.calls).toMatchObject([
      [
        {
          flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
          components: [
            { type: 10, content: expect.stringContaining("`/link`") as string },
          ],
        },
      ],
    ]);
    expect(calls).toEqual([]);
  });

  it("shows upcoming FullParty runs for a linked Discord guild", async () => {
    const deferReply = createAsyncRecorder();
    const editReply = createAsyncRecorder();
    const guildRunsResponse = {
      data: [
        {
          activity_type: {
            difficulty: "ultimate",
            id: 55,
            name: {
              en: "Futures Rewritten (Ultimate)",
            },
          },
          datacenter: "Light",
          display_name: "Friday prog",
          duration_hours: 2.5,
          group: {
            id: 10,
            name: "Guild Linked Group",
            slug: "guildgrp",
          },
          id: 123,
          intensity: "casual",
          is_public: true,
          needs_application: true,
          run_style: "progression",
          starts_at: "2026-06-01T20:00:00+00:00",
          status: "scheduled",
          target_prog_point_key: "phase-2",
          title: "Friday prog",
          urls: {
            overview: "/groups/guildgrp/activities/123",
          },
        },
        {
          datacenter: "Chaos",
          display_name: "Second prog",
          duration_hours: 2,
          group: {
            id: 10,
            name: "Guild Linked Group",
            slug: "guildgrp",
          },
          id: 456,
          starts_at: "2026-06-02T20:00:00+00:00",
          status: "scheduled",
          urls: {
            overview: "/groups/guildgrp/activities/456",
          },
        },
      ],
      meta: {
        count: 2,
        discord_guild_id: "1379217636696789022",
        group: {
          id: 10,
          name: "Guild Linked Group",
          slug: "guildgrp",
        },
        limit: 25,
      },
    };
    const calls: FetchCall[] = [];
    const fetcher = createRecordingJsonFetcher(guildRunsResponse, calls);
    const context = createLinkedGuildContext(fetcher);

    await guildRunsCommand.execute(
      {
        deferReply: deferReply.fn,
        editReply: editReply.fn,
        guildId: "1379217636696789022",
        inGuild: () => true,
        memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild),
        options: {
          getInteger: () => null,
        },
        user: {
          id: "moderator-id",
        },
      } as unknown as ChatInputCommandInteraction,
      context,
    );

    const message = getFirstMessageOptions(editReply);

    expect(deferReply.calls).toEqual([[]]);
    expect(message.content).toBe(
      "Found 2 upcoming FullParty runs for this server. Page 1/2",
    );
    expect(message.embeds).toEqual([
      {
        color: 0x8b5cf6,
        description: "Friday prog in Guild Linked Group.",
        fields: [
          {
            inline: true,
            name: "Run ID",
            value: "123",
          },
          {
            inline: true,
            name: "Starts",
            value: "<t:1780344000:F> (<t:1780344000:R>)",
          },
          {
            inline: true,
            name: "Duration",
            value: "2.5h",
          },
          {
            inline: true,
            name: "Status",
            value: "Scheduled",
          },
          {
            inline: true,
            name: "Group",
            value: "Guild Linked Group",
          },
          {
            inline: true,
            name: "Datacenter",
            value: "Light",
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
          {
            inline: true,
            name: "Applications",
            value: "Required",
          },
          {
            inline: true,
            name: "Target Prog",
            value: "Phase 2",
          },
        ],
        footer: {
          text: "FullParty - Guild Runs • Page 1/2",
        },
        title: "Friday prog",
        url: "http://fullparty.test/groups/guildgrp/activities/123",
      },
    ]);
    expect(message.components?.map((component) => component.toJSON())).toMatchObject([
      {
        components: [
          {
            custom_id: "guildruns:noop:previous:1379217636696789022:moderator-id:25:0",
            disabled: true,
            emoji: {
              animated: false,
              id: undefined,
              name: "⬅️",
            },
            label: "Previous",
            style: 2,
            type: 2,
          },
          {
            emoji: {
              name: "🔎",
            },
            label: "Overview",
            style: 5,
            type: 2,
            url: "http://fullparty.test/groups/guildgrp/activities/123",
          },
          {
            emoji: {
              name: "🛠️",
            },
            label: "Manage",
            style: 5,
            type: 2,
            url: "http://fullparty.test/dashboard/groups/guildgrp/runs/123",
          },
          {
            custom_id: "guildruns:assign:1379217636696789022:moderator-id:25:0:123",
            disabled: false,
            emoji: {
              name: "🛡️",
            },
            label: "Assign Role",
            style: 1,
            type: 2,
          },
          {
            custom_id: "guildruns:1379217636696789022:moderator-id:25:1",
            disabled: false,
            emoji: {
              animated: false,
              id: undefined,
              name: "➡️",
            },
            label: "Next",
            style: 2,
            type: 2,
          },
        ],
        type: 1,
      },
    ]);
    expect(context.payloads.get()).toMatchObject({
      payload: {
        command: "guildruns",
        discord_guild_id: "1379217636696789022",
        ok: true,
        response: guildRunsResponse,
        source: "fullparty.api",
      },
      source: "FullParty /guildruns API response",
    });
    expect(fetchInputToUrl(calls[0]?.input)).toBe(
      "http://fullparty.test/api/integrations/v1/bot/discord-guilds/1379217636696789022/upcoming-runs?limit=25",
    );
  });

  it("edits the /guildruns message when a paginator button is pressed", async () => {
    const deferUpdate = createAsyncRecorder();
    const editReply = createAsyncRecorder();
    const reply = createAsyncRecorder();
    const calls: FetchCall[] = [];
    const fetcher = createRecordingJsonFetcher(
      {
        data: [
          {
            display_name: "First prog",
            group: { name: "Guild Linked Group" },
            id: 123,
            starts_at: "2026-06-01T20:00:00+00:00",
            status: "scheduled",
          },
          {
            display_name: "Second prog",
            group: { name: "Guild Linked Group", slug: "guildgrp" },
            id: 456,
            starts_at: "2026-06-02T20:00:00+00:00",
            status: "scheduled",
            urls: {
              overview: "/groups/guildgrp/activities/456",
            },
          },
        ],
      },
      calls,
    );
    const context = createLinkedGuildContext(fetcher);

    await guildRunsCommand.handleComponent?.(
      {
        customId: "guildruns:1379217636696789022:moderator-id:25:1",
        deferUpdate: deferUpdate.fn,
        editReply: editReply.fn,
        guildId: "1379217636696789022",
        isButton: () => true,
        reply: reply.fn,
        user: {
          id: "moderator-id",
        },
      } as unknown as ButtonInteraction,
      context,
    );

    const message = getFirstMessageOptions(editReply);

    expect(reply.calls).toEqual([]);
    expect(deferUpdate.calls).toEqual([[]]);
    expect(message.content).toBe(
      "Found 2 upcoming FullParty runs for this server. Page 2/2",
    );
    expect(message.embeds?.[0]).toMatchObject({
      footer: {
        text: "FullParty - Guild Runs • Page 2/2",
      },
      title: "Second prog",
    });
    expect(message.components?.map((component) => component.toJSON())).toMatchObject([
      {
        components: [
          {
            custom_id: "guildruns:1379217636696789022:moderator-id:25:0",
            disabled: false,
            emoji: {
              animated: false,
              id: undefined,
              name: "⬅️",
            },
            label: "Previous",
            style: 2,
            type: 2,
          },
          {
            label: "Overview",
            style: 5,
            type: 2,
          },
          {
            label: "Manage",
            style: 5,
            type: 2,
          },
          {
            custom_id: "guildruns:assign:1379217636696789022:moderator-id:25:1:456",
            disabled: false,
            label: "Assign Role",
            style: 1,
            type: 2,
          },
          {
            custom_id: "guildruns:noop:next:1379217636696789022:moderator-id:25:1",
            disabled: true,
            emoji: {
              animated: false,
              id: undefined,
              name: "➡️",
            },
            label: "Next",
            style: 2,
            type: 2,
          },
        ],
        type: 1,
      },
    ]);
    expect(fetchInputToUrl(calls[0]?.input)).toBe(
      "http://fullparty.test/api/integrations/v1/bot/discord-guilds/1379217636696789022/upcoming-runs?limit=25",
    );
  });

  it("uses unique disabled paginator button ids for a single /guildruns page", async () => {
    const deferReply = createAsyncRecorder();
    const editReply = createAsyncRecorder();
    const context = createLinkedGuildContext(
      createJsonFetcher({
        data: [
          {
            display_name: "Only prog",
            group: { name: "Guild Linked Group", slug: "guildgrp" },
            id: 123,
            starts_at: "2026-06-01T20:00:00+00:00",
            status: "scheduled",
          },
        ],
      }),
    );

    await guildRunsCommand.execute(
      {
        deferReply: deferReply.fn,
        editReply: editReply.fn,
        guildId: "1379217636696789022",
        inGuild: () => true,
        memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild),
        options: {
          getInteger: () => 1,
        },
        user: {
          id: "moderator-id",
        },
      } as unknown as ChatInputCommandInteraction,
      context,
    );

    const message = getFirstMessageOptions(editReply);

    expect(message.content).toBe(
      "Found 1 upcoming FullParty run for this server. Page 1/1",
    );
    expect(message.components?.map((component) => component.toJSON())).toMatchObject([
      {
        components: [
          {
            custom_id: "guildruns:noop:previous:1379217636696789022:moderator-id:1:0",
            disabled: true,
            label: "Previous",
          },
          {
            label: "Overview",
          },
          {
            label: "Manage",
          },
          {
            custom_id: "guildruns:assign:1379217636696789022:moderator-id:1:0:123",
            label: "Assign Role",
          },
          {
            custom_id: "guildruns:noop:next:1379217636696789022:moderator-id:1:0",
            disabled: true,
            label: "Next",
          },
        ],
      },
    ]);
  });

  it("posts upcoming FullParty runs to the configured schedule channel", async () => {
    const deferReply = createAsyncRecorder();
    const editReply = createAsyncRecorder();
    const sentMessages: unknown[] = [];
    const guildRunsResponse = {
      data: [
        {
          activity_type: {
            name: {
              en: "Futures Rewritten (Ultimate)",
            },
          },
          counts: {
            assigned_slots: 2,
            total_applicants: 3,
            total_slots: 3,
          },
          display_name: "Futures Rewritten (Ultimate)",
          group: {
            name: "Guild Linked Group",
            slug: "guildgrp",
          },
          host: {
            avatar_url: "https://example.com/host-avatar.png",
            character: {
              avatar_url: "https://example.com/host-character.png",
              datacenter: "Light",
              id: 456,
              name: "Host Character",
              world: "Twintania",
            },
            discord_user_id: "800000000000000001",
            name: "Host Person",
            user_id: 123,
          },
          id: 123,
          starts_at: "2026-06-01T20:00:00+00:00",
          target_prog_point: {
            key: "titan-cleanup",
            label: {
              en: "Titan Cleanup",
            },
            order: 3,
          },
          target_prog_point_key: "titan-cleanup",
          title: "Friday prog",
          urls: {
            application: "/groups/guildgrp/activities/123/application",
            overview: "/groups/guildgrp/activities/123",
          },
        },
      ],
      meta: {
        group: {
          name: "Guild Linked Group",
          slug: "guildgrp",
        },
      },
    };
    const calls: FetchCall[] = [];
    const fetcher = createRecordingJsonFetcher(guildRunsResponse, calls);
    const context = createLinkedGuildContext(fetcher);

    await postRunsCommand.execute(
      {
        channel: {
          send: () => {
            throw new Error("Should not post in the triggering channel.");
          },
        },
        channelId: "trigger-channel-id",
        client: {
          channels: {
            fetch: (channelId: string) =>
              Promise.resolve({
                id: channelId,
                send: (message: unknown) => {
                  sentMessages.push(message);
                  return Promise.resolve({ id: "posted-message-id" });
                },
              }),
          },
        },
        deferReply: deferReply.fn,
        editReply: editReply.fn,
        guildId: "1379217636696789022",
        inGuild: () => true,
        memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild),
        options: {
          getBoolean: () => null,
        },
        user: {
          id: "moderator-id",
        },
      } as unknown as ChatInputCommandInteraction,
      context,
    );

    expect(deferReply.calls).toEqual([[{ flags: MessageFlags.Ephemeral }]]);
    expect(sentMessages).toEqual([
      {
        allowedMentions: {
          parse: [],
        },
        content: [
          "Here are the upcoming FullParty runs for **Guild Linked Group**:",
          "",
          "**Friday prog - Titan Cleanup**",
          "2/3 Participants - 3 Applications - <t:1780344000:F> (<t:1780344000:R>)",
          "Hosted by <@800000000000000001> - [Apply Here](<http://fullparty.test/groups/guildgrp/activities/123/application>)",
          "",
          "-# For the full schedule of **Guild Linked Group** [Click Here](<http://fullparty.test/en/groups/guildgrp/dashboard/activities>)",
        ].join("\n"),
      },
    ]);
    expect(editReply.calls).toEqual([
      [
        {
          content: "Posted the upcoming runs summary in <#run-announcement-channel-id>.",
        },
      ],
    ]);
    expect(fetchInputToUrl(calls[0]?.input)).toBe(
      "http://fullparty.test/api/integrations/v1/bot/discord-guilds/1379217636696789022/upcoming-runs?limit=25",
    );
    expect(context.payloads.get()).toMatchObject({
      payload: {
        command: "postruns",
        discord_guild_id: "1379217636696789022",
        ok: true,
        response: guildRunsResponse,
        source: "fullparty.api",
      },
      source: "FullParty /postruns API response",
    });
  });

  it.each([false, true])(
    "uses the saved Expanded format for /postruns posthere:%s",
    async (postHere) => {
      const context = createLinkedGuildContext(
        createJsonFetcher({
          data: [
            {
              title: "Expanded schedule run",
              starts_at: "2026-10-22T17:00:00Z",
              host: {
                discord_user_id: "800000000000000001",
                avatar_url: "https://example.com/avatar.png",
              },
              counts: { assigned_slots: 3, total_slots: 48, total_applicants: 1 },
              urls: { application: "/groups/example/activities/1/application" },
            },
          ],
        }),
      );
      const getSettings = context.guildSettings.get.bind(context.guildSettings);
      context.guildSettings.get = async (guildId) => ({
        ...(await getSettings(guildId)),
        scheduleFormat: "expanded",
      });
      const send = vi.fn(() => Promise.resolve({ id: "expanded-message" }));
      const fetchChannel = vi.fn(() => Promise.resolve({ send }));
      const editReply = vi.fn(() => Promise.resolve());
      await postRunsCommand.execute(
        {
          channel: { send },
          channelId: "current-channel",
          client: {
            channels: { fetch: fetchChannel },
            application: {
              emojis: {
                cache: new Map([
                  ["123456789012345678", { id: "123456789012345678", name: "fpclock" }],
                ]),
              },
            },
          },
          deferReply: vi.fn(() => Promise.resolve()),
          editReply,
          guildId: "1379217636696789022",
          inGuild: () => true,
          memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild),
          options: { getBoolean: () => postHere },
          user: { id: "moderator-id" },
        } as unknown as ChatInputCommandInteraction,
        context,
      );
      expect(send).toHaveBeenCalledTimes(1);
      const sent = (send.mock.calls as unknown[][])[0]?.[0];
      expect(sent).toMatchObject({
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      });
      expect(sent).not.toHaveProperty("content");
      expect(messageText(sent)).toContain("## Expanded schedule run");
      expect(messageText(sent)).toContain("<:fpclock:123456789012345678>");
      expect(fetchChannel).toHaveBeenCalledTimes(postHere ? 0 : 1);
      expect(editReply).toHaveBeenCalledWith({
        content: postHere
          ? "Posted the upcoming runs summary in this channel."
          : "Posted the upcoming runs summary in <#run-announcement-channel-id>.",
      });
    },
  );

  it("posts upcoming FullParty runs in the triggering channel when requested", async () => {
    const deferReply = createAsyncRecorder();
    const editReply = createAsyncRecorder();
    const sentMessages: unknown[] = [];
    const context = createLinkedGuildContext(
      createJsonFetcher({
        data: [
          {
            counts: {
              applications: 1,
              capacity: 8,
              participants: 4,
            },
            display_name: "No custom title",
            group: {
              name: "Guild Linked Group",
              slug: "guildgrp",
            },
            host: {
              character: {
                name: "Giki Chomusuke",
                world: "Lich",
              },
              discord_user_id: null,
              name: "Host Person",
              user_id: 123,
            },
            starts_at: "2026-06-01T20:00:00+00:00",
            urls: {
              overview: "/groups/guildgrp/activities/456",
            },
          },
        ],
        meta: {
          group: {
            name: "Guild Linked Group",
            slug: "guildgrp",
          },
        },
      }),
    );

    await postRunsCommand.execute(
      {
        channel: {
          send: (message: unknown) => {
            sentMessages.push(message);
            return Promise.resolve({ id: "posted-message-id" });
          },
        },
        channelId: "trigger-channel-id",
        client: {
          channels: {
            fetch: () => {
              throw new Error("Should not fetch the configured channel.");
            },
          },
        },
        deferReply: deferReply.fn,
        editReply: editReply.fn,
        guildId: "1379217636696789022",
        inGuild: () => true,
        memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild),
        options: {
          getBoolean: () => true,
        },
        user: {
          id: "moderator-id",
        },
      } as unknown as ChatInputCommandInteraction,
      context,
    );

    expect(deferReply.calls).toEqual([[{ flags: MessageFlags.Ephemeral }]]);
    expect(sentMessages[0]).toMatchObject({
      content: expect.stringContaining("**No custom title**") as string,
    });
    expect(sentMessages[0]).toMatchObject({
      allowedMentions: {
        parse: [],
      },
      content: expect.stringContaining(
        "Hosted by Giki Chomusuke [Lich] - [Apply Here](<http://fullparty.test/groups/guildgrp/activities/456>)",
      ) as string,
    });
    expect(editReply.calls).toEqual([
      [
        {
          content: "Posted the upcoming runs summary in this channel.",
        },
      ],
    ]);
  });

  it("runs role assignment from a /guildruns paginator button", async () => {
    const deferReply = createAsyncRecorder();
    const editReply = createAsyncRecorder();
    const reply = createAsyncRecorder();
    const calls: FetchCall[] = [];
    const startsAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const fetcher = createRecordingJsonFetcher(
      {
        data: {
          discord_guild: {
            id: "1379217636696789022",
            name: "Role Guild",
          },
          discord_user_ids: ["182520880277094400"],
          group: {
            id: 10,
            name: "Guild Linked Group",
            slug: "guildgrp",
          },
          participants: [
            {
              character: {
                id: 21,
                name: "Giki Chomusuke",
                world: "Lich",
              },
              discord_user_id: "182520880277094400",
              user_id: 5,
            },
          ],
          run: {
            display_name: "AAC Cruiserweight M1 (Savage)",
            id: 6932,
            starts_at: startsAt,
            status: "assigned",
          },
          total_placed_count: 1,
          unlinked_count: 0,
        },
      },
      calls,
    );
    const context = createLinkedGuildContext(fetcher);

    await guildRunsCommand.handleComponent?.(
      {
        client: {
          guilds: {
            fetch: () => {
              throw new Error("Guild should not be fetched without run-role store.");
            },
          },
        },
        customId: "guildruns:assign:1379217636696789022:moderator-id:25:0:6932",
        deferReply: deferReply.fn,
        editReply: editReply.fn,
        guildId: "1379217636696789022",
        isButton: () => true,
        reply: reply.fn,
        user: {
          id: "moderator-id",
        },
      } as unknown as ButtonInteraction,
      context,
    );

    expect(reply.calls).toEqual([]);
    expect(deferReply.calls).toEqual([[]]);
    expect(editReply.calls).toEqual([
      [
        {
          content: [
            "⚠️ Role assignment checked for Run #6932, but nothing was assigned.",
            "Run role: not created",
            "Reason: run role store not configured",
            "Check the bot-log channel for the full status embed.",
          ].join("\n"),
        },
      ],
    ]);
    expect(fetchInputToUrl(calls[0]?.input)).toBe(
      "http://fullparty.test/api/integrations/v1/bot/discord-guilds/1379217636696789022/runs/6932/role-assignment",
    );
  });

  it("manually runs guild role assignment for an eligible run", async () => {
    const deferReply = createAsyncRecorder();
    const editReply = createAsyncRecorder();
    const calls: FetchCall[] = [];
    const roleAdds: string[] = [];
    const createdRoles: string[] = [];
    const startsAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const expectedRunRoleName = `Run: AAC Cruiserweight M1 (Savage) ${formatUtcHourMinute(startsAt)} UTC`;
    const roleAssignmentResponse = {
      data: {
        activity_type: { name: { en: "AAC Cruiserweight M1 (Savage)" } },
        discord_guild: {
          icon_url: null,
          id: "1379217636696789022",
          name: "Role Guild",
        },
        discord_user_ids: ["182520880277094400"],
        group: {
          id: 10,
          name: "Guild Linked Group",
          slug: "guildgrp",
        },
        participants: [
          {
            application: null,
            character: {
              datacenter: "Light",
              id: 21,
              name: "Giki Chomusuke",
              world: "Lich",
            },
            discord_user_id: "182520880277094400",
            slot: {
              id: 77,
              is_bench: false,
              slot_key: "party-a-slot-1",
            },
            source: "slot",
            user_id: 5,
          },
        ],
        run: {
          display_name: "Custom progression night title",
          id: 6932,
          starts_at: startsAt,
          status: "assigned",
        },
        total_placed_count: 2,
        unlinked_count: 1,
      },
    };
    const context = createLinkedGuildContext(
      createRecordingJsonFetcher(roleAssignmentResponse, calls),
    );
    context.guildRunRoles = createMemoryRunRoleStore();
    const templateRole = {
      color: 0x3b82f6,
      colors: { primaryColor: 0x22c55e },
      hoist: false,
      id: "template-role-id",
      mentionable: false,
      name: "Template Raider",
      permissions: {
        bitfield: 0n,
      },
    };
    const runRole = {
      id: "run-role-id",
      name: expectedRunRoleName,
    };

    await assignRunRoleCommand.execute(
      {
        client: {
          channels: {
            fetch: () => Promise.resolve(null),
          },
          guilds: {
            fetch: () =>
              Promise.resolve({
                channels: {
                  fetch: () => Promise.resolve(new Map()),
                },
                members: {
                  fetch: () =>
                    Promise.resolve({
                      roles: {
                        add: (roleId: string) => {
                          roleAdds.push(roleId);
                          return Promise.resolve({});
                        },
                      },
                    }),
                  me: {
                    permissions: {
                      has: () => true,
                    },
                    roles: {
                      highest: {
                        comparePositionTo: () => 1,
                      },
                    },
                  },
                },
                roles: {
                  cache: {
                    get: (roleId: string) =>
                      roleId === "template-role-id" ? templateRole : undefined,
                  },
                  create: (options: { name: string }) => {
                    expect(options).toMatchObject({ colors: { primaryColor: 0x22c55e } });
                    expect(options).not.toHaveProperty("color");
                    createdRoles.push(options.name);
                    return Promise.resolve(runRole);
                  },
                  fetch: (roleId: string) =>
                    Promise.resolve(
                      roleId === "template-role-id" ? templateRole : runRole,
                    ),
                },
              }),
          },
        },
        deferReply: deferReply.fn,
        editReply: editReply.fn,
        guildId: "1379217636696789022",
        inGuild: () => true,
        memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild),
        options: {
          getInteger: () => 6932,
        },
        user: {
          id: "moderator-id",
        },
      } as unknown as ChatInputCommandInteraction,
      context,
    );

    expect(deferReply.calls).toEqual([[{ flags: MessageFlags.Ephemeral }]]);
    expect(roleAdds).toEqual(["run-role-id"]);
    expect(createdRoles).toEqual([expectedRunRoleName]);
    expect(editReply.calls).toEqual([
      [
        {
          content: `✅ Role assignment ran for Run #6932.\nAssigned 1/2 users.\nPlaced users: 2 total, 1 without linked Discord.\nFailed: 1 users.\nRun role: <@&run-role-id> (${expectedRunRoleName})\nCheck the bot-log channel for the full status embed.`,
        },
      ],
    ]);
    expect(fetchInputToUrl(calls[0]?.input)).toBe(
      "http://fullparty.test/api/integrations/v1/bot/discord-guilds/1379217636696789022/runs/6932/role-assignment",
    );
  });

  it("blocks manual guild role assignment outside the allowed time window", async () => {
    const deferReply = createAsyncRecorder();
    const editReply = createAsyncRecorder();
    const startsAt = new Date(Date.now() + 90 * 60 * 1000).toISOString();
    const context = createLinkedGuildContext(
      createJsonFetcher({
        data: {
          discord_guild: {
            id: "1379217636696789022",
            name: "Role Guild",
          },
          participants: [
            {
              discord_user_id: "182520880277094400",
            },
          ],
          run: {
            display_name: "Too Far Away",
            id: 6932,
            starts_at: startsAt,
          },
        },
      }),
    );

    await assignRunRoleCommand.execute(
      {
        client: {
          guilds: {
            fetch: () => {
              throw new Error("Discord guild should not be fetched.");
            },
          },
        },
        deferReply: deferReply.fn,
        editReply: editReply.fn,
        guildId: "1379217636696789022",
        inGuild: () => true,
        memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild),
        options: {
          getInteger: () => 6932,
        },
        user: {
          id: "moderator-id",
        },
      } as unknown as ChatInputCommandInteraction,
      context,
    );

    expect(deferReply.calls).toEqual([[{ flags: MessageFlags.Ephemeral }]]);
    expect(editReply.calls[0]?.[0]).toMatchObject({
      content: expect.stringContaining("within 60 minutes") as string,
    });
  });

  it("debug-runs guild role assignment outside the allowed time window", async () => {
    const deferReply = createAsyncRecorder();
    const editReply = createAsyncRecorder();
    const startsAt = new Date(Date.now() + 90 * 60 * 1000).toISOString();
    const context = createLinkedGuildContext(
      createJsonFetcher({
        data: {
          discord_guild: {
            id: "1379217636696789022",
            name: "Role Guild",
          },
          discord_user_ids: ["123456789012345678"],
          participants: [
            {
              character: {
                name: "Giki Chomusuke",
                world: "Lich",
              },
              discord_user_id: "123456789012345678",
              user_id: 5,
            },
          ],
          run: {
            display_name: "Too Far Away",
            id: 6932,
            starts_at: startsAt,
          },
          total_placed_count: 1,
          unlinked_count: 0,
        },
      }),
    );

    await debugAssignRunRoleCommand.execute(
      {
        client: {
          channels: {
            fetch: () => Promise.resolve(null),
          },
          guilds: {
            fetch: () =>
              Promise.resolve({
                channels: {
                  fetch: () => Promise.resolve(new Map()),
                },
                members: {
                  fetch: () =>
                    Promise.resolve({
                      permissions: {
                        has: () => true,
                      },
                      roles: {
                        add: () => {
                          throw new Error("Dry run should not assign roles.");
                        },
                        highest: {
                          comparePositionTo: () => 1,
                          id: "bot-role-id",
                          name: "Bot Role",
                        },
                      },
                    }),
                  me: {
                    permissions: {
                      has: () => true,
                    },
                    roles: {
                      highest: {
                        comparePositionTo: () => 1,
                        id: "bot-role-id",
                        name: "Bot Role",
                      },
                    },
                  },
                },
                roles: {
                  cache: {
                    get: (roleId: string) =>
                      roleId === "template-role-id"
                        ? {
                            id: roleId,
                            name: "Template Raider",
                            permissions: { bitfield: 0n },
                          }
                        : undefined,
                  },
                  create: () => {
                    throw new Error("Dry run should not create roles.");
                  },
                  fetch: (roleId: string) =>
                    Promise.resolve(
                      roleId === "template-role-id"
                        ? {
                            id: roleId,
                            name: "Template Raider",
                            permissions: { bitfield: 0n },
                          }
                        : undefined,
                    ),
                },
              }),
          },
        },
        deferReply: deferReply.fn,
        editReply: editReply.fn,
        guildId: "1379217636696789022",
        inGuild: () => true,
        memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild),
        options: {
          getInteger: () => 6932,
        },
        user: {
          id: "123456789012345678",
        },
      } as unknown as ChatInputCommandInteraction,
      context,
    );

    expect(deferReply.calls).toEqual([[{ flags: MessageFlags.Ephemeral }]]);
    expect(editReply.calls[0]?.[0]).toMatchObject({
      content: expect.stringContaining("Debug role assignment checked") as string,
    });
    expect(editReply.calls[0]?.[0]).toMatchObject({
      content: expect.stringContaining("No roles were created or assigned") as string,
    });
  });

  it.each([
    { name: "ordinary member", permissions: new PermissionsBitField(0n) },
    {
      name: "member with Manage Roles only",
      permissions: new PermissionsBitField(PermissionFlagsBits.ManageRoles),
    },
  ])(
    "rejects guild linking for $name before any API or settings change",
    async ({ permissions }) => {
      const reply = createAsyncRecorder();
      const deferReply = createAsyncRecorder();
      const editReply = createAsyncRecorder();
      const calls: FetchCall[] = [];
      const context = createContext(createRecordingJsonFetcher({ linked: true }, calls));
      context.guildSettings.get = vi.fn((guildId: string) =>
        Promise.resolve({
          guildId,
          syncDiscordNamesToFf14: false,
          botModeratorRoleId: "bot-moderator-role-id",
        }),
      );
      const update = vi.spyOn(context.guildSettings, "update");
      const linkUser = vi.spyOn(context.fullparty, "linkDiscordUser");
      const linkGuild = vi.spyOn(context.fullparty, "linkDiscordGuild");

      await linkCommand.execute(
        {
          appPermissions: new PermissionsBitField(PermissionFlagsBits.Administrator),
          deferReply: deferReply.fn,
          editReply: editReply.fn,
          guildId: "1379217636696789022",
          inGuild: () => true,
          member: { roles: ["bot-moderator-role-id"] },
          memberPermissions: permissions,
          options: { getString: () => "VALID-GROUP-TOKEN" },
          reply: reply.fn,
          user: { id: "123456789012345678" },
        } as unknown as ChatInputCommandInteraction,
        context,
      );

      expect(reply.calls).toEqual([
        [
          {
            content: "You need Manage Server to link this Discord server to FullParty.",
            flags: MessageFlags.Ephemeral,
          },
        ],
      ]);
      expect(deferReply.calls).toEqual([]);
      expect(editReply.calls).toEqual([]);
      expect(calls).toEqual([]);
      expect(linkGuild).not.toHaveBeenCalled();
      expect(linkUser).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(context.payloads.get()).toBeUndefined();
    },
  );

  it("links the invoking Discord user to FullParty without requiring server permissions", async () => {
    const deferReply = createAsyncRecorder();
    const editReply = createAsyncRecorder();
    const calls: FetchCall[] = [];
    const linkResponse = {
      linked: true,
      data: { account_settings_url: "/settings/notifications" },
    };
    const context = createContext(createRecordingJsonFetcher(linkResponse, calls));

    await linkCommand.execute(
      {
        deferReply: deferReply.fn,
        editReply: editReply.fn,
        inGuild: () => false,
        memberPermissions: null,
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
    expect(editReply.calls).toMatchObject([
      [
        {
          content: "Validating code ABCD1234-EFGH5678 with the FullParty server...",
        },
      ],
      [
        {
          content: null,
          embeds: [],
          flags: MessageFlags.IsComponentsV2,
          allowedMentions: { parse: [], repliedUser: false },
        },
      ],
    ]);
    expect(JSON.stringify(editReply.calls[1])).toContain(
      "http://fullparty.test/settings/notifications",
    );
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

  it.each([
    {
      name: "wrapped group slug",
      response: { linked: true, data: { group_slug: "raid-server" } },
      settingsPath: "/groups/raid-server/dashboard/discord-integration",
    },
    {
      name: "wrapped group object",
      response: { linked: true, data: { group: { slug: "raid-server" } } },
      settingsPath: "/groups/raid-server/dashboard/discord-integration",
    },
    {
      name: "unwrapped group slug",
      response: { linked: true, group_slug: "raid-server" },
      settingsPath: "/groups/raid-server/dashboard/discord-integration",
    },
    {
      name: "unwrapped group object",
      response: { linked: true, group: { slug: "raid-server" } },
      settingsPath: "/groups/raid-server/dashboard/discord-integration",
    },
    {
      name: "explicit settings URL overriding the slug",
      response: {
        linked: true,
        data: {
          discord_settings_url:
            "/groups/raid-server/dashboard/discord-integration?tab=bot",
          group_slug: "other-slug",
        },
      },
      settingsPath: "/groups/raid-server/dashboard/discord-integration?tab=bot",
    },
    {
      name: "blank explicit URL falling back to the slug",
      response: {
        linked: true,
        data: { discord_settings_url: "   ", group_slug: "raid-server" },
      },
      settingsPath: "/groups/raid-server/dashboard/discord-integration",
    },
    {
      name: "unsafe explicit URL falling back to the slug",
      response: {
        linked: true,
        data: { discord_settings_url: "javascript:alert(1)", group_slug: "raid-server" },
      },
      settingsPath: "/groups/raid-server/dashboard/discord-integration",
    },
  ])(
    "links a Discord guild and uses $name for Bot Settings",
    async ({ response: linkResponse, settingsPath }) => {
      const deferReply = createAsyncRecorder();
      const editReply = createAsyncRecorder();
      const calls: FetchCall[] = [];
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
          memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild),
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
      expect(editReply.calls).toMatchObject([
        [
          {
            content: "Validating code ABCD1234-EFGH5678 with the FullParty server...",
          },
        ],
        [
          {
            content: null,
            embeds: [],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [], repliedUser: false },
          },
        ],
      ]);
      expect(JSON.stringify(editReply.calls[1])).toContain(
        `"url":"http://fullparty.test${settingsPath}"`,
      );
      expect(JSON.stringify(editReply.calls[1])).toContain('"label":"Bot Settings"');
      expect(JSON.stringify(editReply.calls[1])).not.toContain("javascript:");
      expect(calls).toHaveLength(1);
      expect(fetchInputToUrl(calls[0]?.input)).toBe(
        "http://fullparty.test/api/integrations/v1/bot/discord-guilds/link",
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
    },
  );

  it("allows an administrator to link a Discord guild without an icon", async () => {
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
        memberPermissions: new PermissionsBitField(PermissionFlagsBits.Administrator),
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
    expect(JSON.stringify(editReply.calls[1])).not.toContain('"label":"Bot Settings"');
    expect(calls).toHaveLength(1);
    expect(parseJsonRequestBody(calls[0])).toEqual({
      discord_guild_id: "1379217636696789022",
      icon_url: null,
      name: "Raid Server",
      permissions: "7336347924769856",
      token: "JHGC7JJQ-TXEOUHAR",
    });
  });

  it.each([
    ["https://fullparty.gg", "https://fullparty.gg/auth/discord-app/user/redirect", null],
    ["https://fullparty.gg/", "https://fullparty.gg/auth/discord-app/user/redirect", ""],
    [
      "http://fullparty.test",
      "http://fullparty.test/auth/discord-app/user/redirect",
      null,
    ],
    [
      "http://fullparty.test/settings/",
      "http://fullparty.test/auth/discord-app/user/redirect",
      "   ",
    ],
  ])(
    "offers automatic account setup from %s when no DM token is provided",
    async (fullpartyWebBaseUrl, expectedUrl, token) => {
      const deferReply = createAsyncRecorder();
      const editReply = createAsyncRecorder();
      const calls: FetchCall[] = [];
      const context = createContext(createRecordingJsonFetcher({}, calls));
      context.fullpartyWebBaseUrl = fullpartyWebBaseUrl;

      await linkCommand.execute(
        {
          deferReply: deferReply.fn,
          editReply: editReply.fn,
          inGuild: () => false,
          options: {
            getString: () => token,
          },
          user: {
            id: "123456789012345678",
          },
        } as unknown as ChatInputCommandInteraction,
        context,
      );

      expect(deferReply.calls).toEqual([[]]);
      expect(editReply.calls).toHaveLength(1);
      const message = getFirstMessageOptions(editReply);
      expect(message.content).toBeUndefined();
      expect(JSON.stringify(message)).toMatch(/sign in/i);
      expect(JSON.stringify(message)).toMatch(/authori[sz]e/i);
      expect(JSON.stringify(message)).toContain("/link token:<code>");
      const serializedMessage = JSON.parse(JSON.stringify(message)) as unknown;
      expect(serializedMessage).toMatchObject({
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [], repliedUser: false },
      });
      expect(JSON.stringify(serializedMessage)).toContain(`"url":"${expectedUrl}"`);
      expect(JSON.stringify(serializedMessage)).toContain(
        '"label":"Finish Discord Setup"',
      );
      expect(calls).toEqual([]);
    },
  );

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
        memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild),
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
    expect(editReply.calls).toMatchObject([
      [
        {
          flags: MessageFlags.IsComponentsV2,
          allowedMentions: { parse: [], repliedUser: false },
        },
      ],
    ]);
    expect(JSON.stringify(editReply.calls)).toContain("/link token:<code>");
    expect(JSON.stringify(editReply.calls)).toContain("Generate Link Token");
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
        memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild),
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

function createLinkedGuildContext(
  fetcher: typeof fetch = createDefaultFetcher(),
): BotContext {
  const context = createContext(fetcher);

  context.guildSettings = {
    get: (guildId) =>
      Promise.resolve({
        guildId,
        linkedAt: "2026-05-30T00:00:00.000Z",
        runAnnouncementChannelId: "run-announcement-channel-id",
        syncDiscordNamesToFf14: false,
        upcomingRaiderRoleId: "template-role-id",
      }),
    update: (guildId) =>
      Promise.resolve({
        guildId,
        linkedAt: "2026-05-30T00:00:00.000Z",
        runAnnouncementChannelId: "run-announcement-channel-id",
        syncDiscordNamesToFf14: false,
        upcomingRaiderRoleId: "template-role-id",
      }),
  };

  return context;
}

function createMemoryRunRoleStore(): NonNullable<BotContext["guildRunRoles"]> {
  const mappings = new Map<
    string,
    Awaited<ReturnType<NonNullable<BotContext["guildRunRoles"]>["upsert"]>>
  >();

  return {
    get: (discordGuildId, runId) =>
      Promise.resolve(mappings.get(`${discordGuildId}:${String(runId)}`)),
    markDeleted: (discordGuildId, runId) => {
      mappings.delete(`${discordGuildId}:${String(runId)}`);

      return Promise.resolve();
    },
    markDeletedByRole: (_discordGuildId, roleId) => {
      for (const [key, mapping] of mappings.entries()) {
        if (mapping.roleId === roleId) {
          mappings.delete(key);
        }
      }

      return Promise.resolve();
    },
    upsert: (mapping) => {
      mappings.set(`${mapping.discordGuildId}:${String(mapping.runId)}`, mapping);

      return Promise.resolve(mapping);
    },
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

function formatUtcHourMinute(value: string): string {
  const date = new Date(value);

  return `${date.getUTCHours().toString().padStart(2, "0")}:${date
    .getUTCMinutes()
    .toString()
    .padStart(2, "0")}`;
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

type RecordedMessageOptions = {
  components?: { toJSON(): unknown }[];
  content?: string;
  embeds?: unknown[];
};

function getFirstMessageOptions(recorder: {
  calls: unknown[][];
}): RecordedMessageOptions {
  const firstArg = recorder.calls[0]?.[0];

  if (!isRecord(firstArg)) {
    throw new Error("Expected first recorded call to contain message options.");
  }

  return firstArg;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
