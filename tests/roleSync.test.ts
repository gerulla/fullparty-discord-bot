import {
  ApplicationCommandOptionType,
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  PermissionsBitField,
  type ChatInputCommandInteraction,
  type Interaction,
} from "discord.js";
import { describe, expect, it, vi } from "vitest";
import type { BotContext } from "../src/bot/context.js";
import { roleSyncCommand } from "../src/commands/roleSync.js";
import { FullpartyApiClient } from "../src/fullparty/client.js";
import type { FailureReporter } from "../src/health/failureReporter.js";
import { createInteractionHandler } from "../src/interactions/handleInteraction.js";
import { LatestPayloadStore } from "../src/payloads/latestPayloadStore.js";

function member(id: string, roleIds: string[]) {
  const cache = new Map(roleIds.map((roleId) => [roleId, { id: roleId }]));
  return {
    id,
    roles: {
      cache,
      add: vi.fn<(roleId: string, reason: string) => Promise<void>>((roleId) => {
        cache.set(roleId, { id: roleId });
        return Promise.resolve();
      }),
      remove: vi.fn(),
      set: vi.fn(),
    },
  };
}

function fixture() {
  const giveRole = { id: "target", managed: false };
  const sourceRole = { id: "source", managed: false };
  const requester = {
    permissions: new PermissionsBitField(PermissionFlagsBits.ManageRoles),
    roles: { highest: { comparePositionTo: vi.fn(() => 1) } },
  };
  const bot = {
    permissions: new PermissionsBitField(PermissionFlagsBits.ManageRoles),
    roles: { highest: { comparePositionTo: vi.fn(() => 1) } },
  };
  const matching = member("matching", ["source", "unrelated"]);
  const alreadyAssigned = member("already-assigned", ["source", "target"]);
  const unrelated = member("unrelated", ["unrelated"]);
  const members = new Map(
    [matching, alreadyAssigned, unrelated].map((entry) => [entry.id, entry]),
  );
  const fetchAll = vi.fn(() => Promise.resolve(members));
  const guild = {
    id: "guild",
    ownerId: "owner",
    roles: {
      fetch: vi.fn(() =>
        Promise.resolve(
          new Map([
            [giveRole.id, giveRole],
            [sourceRole.id, sourceRole],
          ]),
        ),
      ),
    },
    members: {
      // The cache is deliberately empty. Only the full fetch finds matching members.
      cache: new Map(),
      fetch: vi.fn((options?: { user: string; force: boolean }) =>
        options ? Promise.resolve(requester) : fetchAll(),
      ),
      fetchMe: vi.fn(() => Promise.resolve(bot)),
    },
  };
  const recordFailure = vi.fn<FailureReporter["record"]>((input) =>
    Promise.resolve({ ...input, id: 1, occurredAt: "2026-10-07T12:00:00Z" }),
  );
  const context = {
    fullparty: new FullpartyApiClient({ baseUrl: "https://fullparty.gg/api" }),
    fullpartyWebBaseUrl: "https://fullparty.gg",
    payloads: new LatestPayloadStore(),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    failureReporter: { record: recordFailure, getHealthSummary: vi.fn() },
    guildSettings: {
      get: vi.fn((guildId: string) =>
        Promise.resolve({ guildId, syncDiscordNamesToFf14: false }),
      ),
      update: vi.fn((guildId: string) =>
        Promise.resolve({ guildId, syncDiscordNamesToFf14: false }),
      ),
    },
  } satisfies BotContext;
  const selected = { give: "target", source: "source" };
  const interaction = {
    commandName: "rolesync",
    guildId: "guild",
    guild,
    user: { id: "requester" },
    inGuild: () => true,
    isChatInputCommand: () => true,
    memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageRoles),
    appPermissions: new PermissionsBitField(PermissionFlagsBits.ManageRoles),
    options: {
      getRole: vi.fn((name: string) => ({
        id: name === "give-role-id" ? selected.give : selected.source,
      })),
    },
    deferred: false,
    reply: vi.fn<ChatInputCommandInteraction["reply"]>(),
    deferReply: vi.fn<() => Promise<void>>(),
    editReply: vi.fn<ChatInputCommandInteraction["editReply"]>(),
  };
  interaction.deferReply.mockImplementation(() => {
    interaction.deferred = true;
    return Promise.resolve();
  });
  const handler = createInteractionHandler(context, [roleSyncCommand]);
  return {
    interaction,
    run: () => handler(interaction as unknown as Interaction),
    guild,
    giveRole,
    sourceRole,
    requester,
    bot,
    selected,
    fetchAll,
    matching,
    alreadyAssigned,
    unrelated,
    members,
    recordFailure,
    context,
  };
}

describe("/rolesync", () => {
  it("registers two required role pickers for guild role managers", () => {
    expect(roleSyncCommand.data.toJSON()).toMatchObject({
      name: "rolesync",
      integration_types: [ApplicationIntegrationType.GuildInstall],
      contexts: [InteractionContextType.Guild],
      default_member_permissions: String(PermissionFlagsBits.ManageRoles),
      options: [
        { name: "give-role-id", type: ApplicationCommandOptionType.Role, required: true },
        {
          name: "to-users-with-role-id",
          type: ApplicationCommandOptionType.Role,
          required: true,
        },
      ],
    });
  });

  it("copies membership from a full fetch, preserving roles and skipping existing assignments", async () => {
    const f = fixture();
    await f.run();

    expect(f.fetchAll).toHaveBeenCalledOnce();
    expect(f.guild.members.fetch).toHaveBeenCalledWith({
      user: "requester",
      force: true,
    });
    expect(f.guild.members.fetchMe).toHaveBeenCalledWith({ force: true });
    expect(f.matching.roles.add).toHaveBeenCalledWith(
      "target",
      "FullParty /rolesync from role source by Discord user requester.",
    );
    expect([...f.matching.roles.cache.keys()]).toEqual(["source", "unrelated", "target"]);
    for (const entry of f.members.values()) {
      expect(entry.roles.remove).not.toHaveBeenCalled();
      expect(entry.roles.set).not.toHaveBeenCalled();
    }
    expect(f.alreadyAssigned.roles.add).not.toHaveBeenCalled();
    expect(f.unrelated.roles.add).not.toHaveBeenCalled();
    expect(f.context.guildSettings.get).not.toHaveBeenCalled();
    expect(f.interaction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
    expect(f.interaction.editReply).toHaveBeenLastCalledWith({
      content: expect.stringContaining(
        "Matched: 2. Added: 1. Already had role: 1. Failed: 0.",
      ) as string,
      allowedMentions: { parse: [] },
    });
    await f.run();
    expect(f.matching.roles.add).toHaveBeenCalledOnce();
    expect(f.interaction.editReply).toHaveBeenLastCalledWith({
      content: expect.stringContaining(
        "Matched: 2. Added: 0. Already had role: 2. Failed: 0.",
      ) as string,
      allowedMentions: { parse: [] },
    });
  });

  it("reports an empty source role without modifying anyone", async () => {
    const f = fixture();
    f.members.clear();
    await f.run();
    expect(f.matching.roles.add).not.toHaveBeenCalled();
    expect(f.interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining(
        "Matched: 0. Added: 0. Already had role: 0. Failed: 0.",
      ) as string,
      allowedMentions: { parse: [] },
    });
  });

  it.each([
    [50013, false],
    [500, true],
  ])(
    "continues after a member failure (%i) and records its health impact",
    async (code, affectsHealth) => {
      const f = fixture();
      f.matching.roles.add.mockRejectedValueOnce(
        Object.assign(new Error("Cannot add role"), { code }),
      );
      const later = member("later", ["source"]);
      f.members.set(later.id, later);
      await f.run();
      expect(later.roles.add).toHaveBeenCalledOnce();
      expect(f.recordFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "rolesync",
          discordUserId: "matching",
          affectsHealth,
          errorCode: String(code),
          details: expect.objectContaining({
            giveRoleId: "target",
            sourceRoleId: "source",
            requestedByUserId: "requester",
          }) as Record<string, unknown>,
        }),
      );
      expect(f.interaction.editReply).toHaveBeenLastCalledWith({
        content: expect.stringContaining(
          "Matched: 3. Added: 1. Already had role: 1. Failed: 1.",
        ) as string,
        allowedMentions: { parse: [] },
      });
    },
  );

  it.each(["DM", "caller permission", "bot permission"])(
    "rejects %s before fetching members",
    async (scenario) => {
      const f = fixture();
      if (scenario === "DM") f.interaction.inGuild = () => false;
      if (scenario === "caller permission")
        f.interaction.memberPermissions = new PermissionsBitField(
          PermissionFlagsBits.ManageGuild,
        );
      if (scenario === "bot permission")
        f.interaction.appPermissions = new PermissionsBitField();
      await f.run();
      expect(f.fetchAll).not.toHaveBeenCalled();
      expect(f.matching.roles.add).not.toHaveBeenCalled();
      expect(f.interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: MessageFlags.Ephemeral }),
      );
    },
  );

  it.each([
    ["same role", "two different roles"],
    ["missing target", "find both selected roles"],
    ["missing source", "find both selected roles"],
    ["everyone", "@everyone"],
    ["managed", "managed by Discord"],
    ["caller equal role", "below your highest role"],
    ["caller lower role", "below your highest role"],
    ["bot equal role", "my highest role must be above"],
    ["bot lower role", "my highest role must be above"],
    ["revoked caller permission", "You need Manage Roles"],
    ["revoked bot permission", "I need Manage Roles"],
  ])("rejects %s before changing roles", async (scenario, message) => {
    const f = fixture();
    switch (scenario) {
      case "same role":
        f.selected.give = "source";
        break;
      case "missing target":
        f.selected.give = "missing";
        break;
      case "missing source":
        f.selected.source = "missing";
        break;
      case "everyone":
        f.giveRole.id = f.guild.id;
        f.selected.give = f.guild.id;
        break;
      case "managed":
        f.giveRole.managed = true;
        break;
      case "caller equal role":
        f.requester.roles.highest.comparePositionTo.mockReturnValue(0);
        break;
      case "caller lower role":
        f.requester.roles.highest.comparePositionTo.mockReturnValue(-1);
        break;
      case "bot equal role":
        f.bot.roles.highest.comparePositionTo.mockReturnValue(0);
        break;
      case "bot lower role":
        f.bot.roles.highest.comparePositionTo.mockReturnValue(-1);
        break;
      case "revoked caller permission":
        f.requester.permissions = new PermissionsBitField();
        break;
      case "revoked bot permission":
        f.bot.permissions = new PermissionsBitField();
        break;
    }
    await f.run();
    expect(f.fetchAll).not.toHaveBeenCalled();
    expect(f.matching.roles.add).not.toHaveBeenCalled();
    expect(f.interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining(message) as string,
    });
  });

  it("allows the server owner to give a role above their own roles", async () => {
    const f = fixture();
    f.guild.ownerId = f.interaction.user.id;
    f.requester.roles.highest.comparePositionTo.mockReturnValue(-1);
    await f.run();
    expect(f.matching.roles.add).toHaveBeenCalledOnce();
  });

  it("can read membership of a managed source role", async () => {
    const f = fixture();
    f.sourceRole.managed = true;
    await f.run();
    expect(f.matching.roles.add).toHaveBeenCalledOnce();
  });

  it("stops before any assignments when a complete member fetch fails", async () => {
    const f = fixture();
    f.fetchAll.mockRejectedValueOnce(new Error("Member fetch timed out"));
    await f.run();
    expect(f.matching.roles.add).not.toHaveBeenCalled();
    expect(f.interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining("no roles were changed") as string,
    });
  });
});
