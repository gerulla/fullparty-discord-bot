import {
  MessageFlags,
  PermissionFlagsBits,
  PermissionsBitField,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type ChatInputCommandInteraction,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { describe, expect, it } from "vitest";

import type { BotContext } from "../src/bot/context.js";
import { setupCommand } from "../src/commands/setup.js";
import { FullpartyApiClient } from "../src/fullparty/client.js";
import type { GuildSettings, GuildSettingsPatch } from "../src/guildSettings/types.js";
import { LatestPayloadStore } from "../src/payloads/latestPayloadStore.js";
import { createInteractionHandler } from "../src/interactions/handleInteraction.js";

describe("setupCommand", () => {
  it("opens the setup panel for guild managers", async () => {
    const context = createContext({
      guildId: "guild-id",
      syncDiscordNamesToFf14: false,
    });
    const reply = createAsyncRecorder();

    await setupCommand.execute(
      createChatInputInteraction({
        reply: reply.fn,
      }),
      context,
    );

    expect(reply.calls).toHaveLength(1);
    expect(reply.calls[0]?.[0]).toMatchObject({
      content: expect.stringContaining("FullParty Server Setup") as string,
      flags: MessageFlags.Ephemeral,
    });
    expect(reply.calls[0]?.[0]).toMatchObject({
      content: expect.stringContaining("2. Member-Facing Channel") as string,
    });
    expect(reply.calls[0]?.[0]).toMatchObject({
      content: expect.stringContaining("3. Template Role") as string,
    });
    expect(getReplyComponents(reply)).toHaveLength(5);
  });

  it("lists configured template role overrides in the setup panel", async () => {
    const context = createContext({
      guildId: "guild-id",
      runRoleTemplateOverrides: [
        {
          activityId: 321,
          activityName: "Abyssos Savage",
          roleId: "abyssos-role-id",
        },
        {
          activityId: 654,
          activityName: "Eden Ultimate",
          roleId: "eden-role-id",
        },
      ],
      syncDiscordNamesToFf14: false,
    });
    const reply = createAsyncRecorder();

    await setupCommand.execute(
      createChatInputInteraction({
        reply: reply.fn,
      }),
      context,
    );

    expect(reply.calls[0]?.[0]).toMatchObject({
      content: expect.stringContaining("**Template Role Overrides:**") as string,
    });
    expect(reply.calls[0]?.[0]).toMatchObject({
      content: expect.stringContaining(
        "<@&abyssos-role-id> - Abyssos Savage (321)",
      ) as string,
    });
    expect(reply.calls[0]?.[0]).toMatchObject({
      content: expect.stringContaining(
        "<@&eden-role-id> - Eden Ultimate (654)",
      ) as string,
    });
  });

  it("blocks setup outside guilds", async () => {
    const reply = createAsyncRecorder();

    await setupCommand.execute(
      createChatInputInteraction({
        guildId: null,
        inGuild: () => false,
        reply: reply.fn,
      }),
      createContext(),
    );

    expect(reply.calls).toEqual([
      [
        {
          content: "Setup can only be run inside a Discord server.",
          flags: MessageFlags.Ephemeral,
        },
      ],
    ]);
  });

  it("blocks setup for members without Manage Server", async () => {
    const reply = createAsyncRecorder();

    await setupCommand.execute(
      createChatInputInteraction({
        memberPermissions: new PermissionsBitField(0n),
        reply: reply.fn,
      }),
      createContext(),
    );

    expect(reply.calls).toEqual([
      [
        {
          content: "You need the Manage Server permission to run FullParty setup.",
          flags: MessageFlags.Ephemeral,
        },
      ],
    ]);
  });

  it("saves the selected bot-log channel", async () => {
    const context = createContext();
    const update = createAsyncRecorder();

    await setupCommand.handleComponent?.(
      createChannelSelectInteraction({
        customId: "setup:bot_log_channel",
        update: update.fn,
        values: ["bot-log-channel-id"],
      }),
      context,
    );

    expect(context.patches).toEqual([
      {
        botLogChannelId: "bot-log-channel-id",
      },
    ]);
    expect(update.calls[0]?.[0]).toMatchObject({
      content: expect.stringContaining("<#bot-log-channel-id>") as string,
    });
  });

  it("saves the selected run announcement channel", async () => {
    const context = createContext();
    const update = createAsyncRecorder();

    await setupCommand.handleComponent?.(
      createChannelSelectInteraction({
        customId: "setup:run_announcement_channel",
        update: update.fn,
        values: ["run-announcement-channel-id"],
      }),
      context,
    );

    expect(context.patches).toEqual([
      {
        runAnnouncementChannelId: "run-announcement-channel-id",
      },
    ]);
  });

  it("warns when a selected channel is missing send permissions", async () => {
    const context = createContext();
    const update = createAsyncRecorder();

    await setupCommand.handleComponent?.(
      createChannelSelectInteraction({
        channel: {
          permissionsFor: () => new PermissionsBitField(PermissionFlagsBits.ViewChannel),
        },
        customId: "setup:run_announcement_channel",
        update: update.fn,
        values: ["run-announcement-channel-id"],
      }),
      context,
    );

    expect(context.patches).toEqual([
      {
        runAnnouncementChannelId: "run-announcement-channel-id",
      },
    ]);
    expect(update.calls[0]?.[0]).toMatchObject({
      content: expect.stringContaining(
        "Member-Facing Channel preflight: I cannot fully send messages",
      ) as string,
    });
    expect(update.calls[0]?.[0]).toMatchObject({
      content: expect.stringContaining("Send Messages, Embed Links") as string,
    });
  });

  it("does not warn when a selected channel is sendable", async () => {
    const context = createContext();
    const update = createAsyncRecorder();

    await setupCommand.handleComponent?.(
      createChannelSelectInteraction({
        channel: {
          permissionsFor: () =>
            new PermissionsBitField(
              PermissionFlagsBits.ViewChannel |
                PermissionFlagsBits.SendMessages |
                PermissionFlagsBits.EmbedLinks,
            ),
        },
        customId: "setup:bot_log_channel",
        update: update.fn,
        values: ["bot-log-channel-id"],
      }),
      context,
    );

    expect(update.calls[0]?.[0]).toMatchObject({
      content: expect.not.stringContaining("preflight") as string,
    });
  });

  it("saves the selected upcoming raider role", async () => {
    const context = createContext();
    const update = createAsyncRecorder();

    await setupCommand.handleComponent?.(
      createRoleSelectInteraction({
        update: update.fn,
        values: ["upcoming-raider-role-id"],
      }),
      context,
    );

    expect(context.patches).toEqual([
      {
        upcomingRaiderRoleId: "upcoming-raider-role-id",
      },
    ]);
  });

  it("saves the selected bot moderator role", async () => {
    const context = createContext();
    const update = createAsyncRecorder();

    await setupCommand.handleComponent?.(
      createRoleSelectInteraction({
        customId: "setup:bot_moderator_role",
        update: update.fn,
        values: ["bot-moderator-role-id"],
      }),
      context,
    );

    expect(context.patches).toEqual([
      {
        botModeratorRoleId: "bot-moderator-role-id",
      },
    ]);
  });

  it("saves the name sync preference", async () => {
    const context = createContext();
    const update = createAsyncRecorder();

    await setupCommand.handleComponent?.(
      createButtonInteraction({
        customId: "setup:name_sync:enabled",
        update: update.fn,
      }),
      context,
    );

    expect(context.patches).toEqual([
      {
        syncDiscordNamesToFf14: true,
      },
    ]);
  });

  it("opens a separate automatic schedule panel and can return to the five-row setup", async () => {
    const context = createContext();
    const update = createAsyncRecorder();
    await setupCommand.handleComponent?.(
      createButtonInteraction({ customId: "setup:schedule:open", update: update.fn }),
      context,
    );
    expect(update.calls[0]?.[0]).toMatchObject({
      content: expect.stringContaining("Automatic Schedule") as string,
    });
    expect(getReplyComponents(update)).toHaveLength(3);
    expect(JSON.stringify(update.calls)).toContain("Weekly");
    await setupCommand.handleComponent?.(
      createButtonInteraction({ customId: "setup:back", update: update.fn }),
      context,
    );
    expect(update.calls[1]?.[0]).toMatchObject({
      content: expect.stringContaining("FullParty Server Setup") as string,
    });
    expect(context.patches).toEqual([]);
  });

  it.each([1, 2, 3, 4, 5, 6, 7])(
    "routes the frequency select and saves %i days",
    async (days) => {
      const context = createContext();
      const update = createAsyncRecorder();
      const interaction = {
        customId: "setup:schedule:interval",
        guildId: "guild-id",
        inGuild: () => true,
        memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild),
        update: update.fn,
        reply: createAsyncRecorder().fn,
        isChatInputCommand: () => false,
        isButton: () => false,
        isChannelSelectMenu: () => false,
        isRoleSelectMenu: () => false,
        isStringSelectMenu: () => true,
        values: [String(days)],
        user: { id: "manager" },
      } as unknown as StringSelectMenuInteraction;
      await createInteractionHandler(context, [setupCommand])(interaction);
      expect(context.patches).toEqual([{ scheduleRefreshIntervalDays: days }]);
      expect(update.calls).toHaveLength(1);
    },
  );

  it("warns about history permission without requiring embeds in the schedule channel", async () => {
    const context = createContext();
    const update = createAsyncRecorder();
    await setupCommand.handleComponent?.(
      createChannelSelectInteraction({
        customId: "setup:schedule:channel",
        values: ["schedule-channel"],
        update: update.fn,
        channel: {
          permissionsFor: () =>
            new PermissionsBitField([
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
            ]),
        },
      }),
      context,
    );
    expect(context.patches).toEqual([{ scheduleRefreshChannelId: "schedule-channel" }]);
    expect(JSON.stringify(update.calls)).toContain("Read Message History");
    expect(JSON.stringify(update.calls)).not.toContain("Embed Links");
  });

  it("requires a link and a chosen channel before enabling schedules", async () => {
    for (const linked of [false, true]) {
      const context = createContext({
        guildId: "guild-id",
        syncDiscordNamesToFf14: false,
        ...(linked ? { linkedAt: "2026-09-11T00:00:00Z" } : {}),
      });
      const update = createAsyncRecorder();
      await setupCommand.handleComponent?.(
        createButtonInteraction({ customId: "setup:schedule:enable", update: update.fn }),
        context,
      );
      expect(context.patches).toEqual([]);
      expect(JSON.stringify(update.calls)).toContain(
        linked ? "Choose a schedule channel" : "Link this server",
      );
    }
  });

  it("lets managers enable or disable scheduling after configuration", async () => {
    const context = createContext({
      guildId: "guild-id",
      syncDiscordNamesToFf14: false,
      linkedAt: "2026-09-11T00:00:00Z",
      scheduleRefreshChannelId: "schedule-channel",
    });
    const update = createAsyncRecorder();
    await setupCommand.handleComponent?.(
      createButtonInteraction({ customId: "setup:schedule:enable", update: update.fn }),
      context,
    );
    await setupCommand.handleComponent?.(
      createButtonInteraction({ customId: "setup:schedule:disable", update: update.fn }),
      context,
    );
    expect(context.patches).toEqual([
      { scheduleRefreshEnabled: true },
      { scheduleRefreshEnabled: false },
    ]);
  });

  it("does not let non-managers change automatic schedules", async () => {
    const context = createContext();
    const reply = createAsyncRecorder();
    await setupCommand.handleComponent?.(
      createButtonInteraction({
        customId: "setup:schedule:disable",
        memberPermissions: new PermissionsBitField(),
        reply: reply.fn,
      }),
      context,
    );
    expect(context.patches).toEqual([]);
    expect(JSON.stringify(reply.calls)).toContain("Manage Server");
  });
});

type TestContext = BotContext & {
  patches: GuildSettingsPatch[];
};

type AsyncRecorder = {
  calls: unknown[][];
  fn: (...args: unknown[]) => Promise<void>;
};

type BaseInteractionOptions = {
  guildId?: string | null;
  inGuild?: () => boolean;
  memberPermissions?: PermissionsBitField;
  reply?: (...args: unknown[]) => Promise<void>;
};

type ComponentInteractionOptions = BaseInteractionOptions & {
  channel?: unknown;
  customId?: string;
  update?: (...args: unknown[]) => Promise<void>;
  values?: string[];
};

function createContext(initialSettings?: GuildSettings): TestContext {
  const settings: GuildSettings = initialSettings ?? {
    guildId: "guild-id",
    syncDiscordNamesToFf14: false,
  };
  const patches: GuildSettingsPatch[] = [];

  return {
    fullparty: new FullpartyApiClient({
      baseUrl: "https://api.fullparty.gg",
      fetcher: () => Promise.resolve(new Response(null, { status: 204 })),
    }),
    fullpartyWebBaseUrl: "https://fullparty.gg",
    guildSettings: {
      get: (guildId) =>
        Promise.resolve({
          ...settings,
          guildId,
        }),
      update: (guildId, patch) => {
        patches.push(patch);

        return Promise.resolve(mergeTestSettings(settings, guildId, patch));
      },
    },
    logger: {
      debug: () => undefined,
      error: () => undefined,
      info: () => undefined,
      warn: () => undefined,
    },
    payloads: new LatestPayloadStore(),
    patches,
  };
}

function mergeTestSettings(
  settings: GuildSettings,
  guildId: string,
  patch: GuildSettingsPatch,
): GuildSettings {
  const next: GuildSettings = {
    ...settings,
    guildId,
    ...(settings.runRoleTemplateOverrides
      ? { runRoleTemplateOverrides: settings.runRoleTemplateOverrides }
      : {}),
    syncDiscordNamesToFf14:
      patch.syncDiscordNamesToFf14 ?? settings.syncDiscordNamesToFf14,
    scheduleRefreshEnabled:
      patch.scheduleRefreshEnabled ?? settings.scheduleRefreshEnabled ?? false,
    scheduleRefreshIntervalDays:
      patch.scheduleRefreshIntervalDays ?? settings.scheduleRefreshIntervalDays ?? 1,
  };

  setOptionalSetting(next, "botLogChannelId", patch, settings);
  setOptionalSetting(next, "botModeratorRoleId", patch, settings);
  setOptionalSetting(next, "runAnnouncementChannelId", patch, settings);
  setOptionalSetting(next, "upcomingRaiderRoleId", patch, settings);
  setOptionalSetting(next, "scheduleRefreshChannelId", patch, settings);

  return next;
}

function setOptionalSetting(
  next: GuildSettings,
  key: keyof Omit<
    GuildSettingsPatch,
    | "runRoleTemplateOverrides"
    | "syncDiscordNamesToFf14"
    | "scheduleRefreshEnabled"
    | "scheduleRefreshIntervalDays"
  >,
  patch: GuildSettingsPatch,
  settings: GuildSettings,
): void {
  const value = Object.prototype.hasOwnProperty.call(patch, key)
    ? patch[key]
    : settings[key];

  if (value) {
    next[key] = value;
  }
}

function createChatInputInteraction(
  options: BaseInteractionOptions = {},
): ChatInputCommandInteraction {
  const reply = createAsyncRecorder();

  return {
    guildId: options.guildId ?? "guild-id",
    inGuild: options.inGuild ?? (() => true),
    memberPermissions:
      options.memberPermissions ??
      new PermissionsBitField(PermissionFlagsBits.ManageGuild),
    reply: options.reply ?? reply.fn,
  } as unknown as ChatInputCommandInteraction;
}

function createChannelSelectInteraction(
  options: ComponentInteractionOptions = {},
): ChannelSelectMenuInteraction {
  const reply = createAsyncRecorder();
  const update = createAsyncRecorder();

  return {
    customId: options.customId ?? "setup:bot_log_channel",
    guildId: options.guildId ?? "guild-id",
    inGuild: options.inGuild ?? (() => true),
    isButton: () => false,
    isChannelSelectMenu: () => true,
    isRoleSelectMenu: () => false,
    memberPermissions:
      options.memberPermissions ??
      new PermissionsBitField(PermissionFlagsBits.ManageGuild),
    channels: {
      get: (channelId: string) =>
        channelId === (options.values ?? ["channel-id"]).at(0)
          ? options.channel
          : undefined,
    },
    guild: {
      members: {
        me: {
          id: "bot-user-id",
        },
      },
    },
    reply: options.reply ?? reply.fn,
    update: options.update ?? update.fn,
    values: options.values ?? ["channel-id"],
  } as unknown as ChannelSelectMenuInteraction;
}

function createRoleSelectInteraction(
  options: ComponentInteractionOptions = {},
): RoleSelectMenuInteraction {
  const reply = createAsyncRecorder();
  const update = createAsyncRecorder();

  return {
    customId: options.customId ?? "setup:upcoming_raider_role",
    guildId: options.guildId ?? "guild-id",
    inGuild: options.inGuild ?? (() => true),
    isButton: () => false,
    isChannelSelectMenu: () => false,
    isRoleSelectMenu: () => true,
    memberPermissions:
      options.memberPermissions ??
      new PermissionsBitField(PermissionFlagsBits.ManageGuild),
    reply: options.reply ?? reply.fn,
    update: options.update ?? update.fn,
    values: options.values ?? ["role-id"],
  } as unknown as RoleSelectMenuInteraction;
}

function createButtonInteraction(
  options: ComponentInteractionOptions = {},
): ButtonInteraction {
  const reply = createAsyncRecorder();
  const update = createAsyncRecorder();

  return {
    customId: options.customId ?? "setup:name_sync:enabled",
    guildId: options.guildId ?? "guild-id",
    inGuild: options.inGuild ?? (() => true),
    isButton: () => true,
    isChannelSelectMenu: () => false,
    isRoleSelectMenu: () => false,
    memberPermissions:
      options.memberPermissions ??
      new PermissionsBitField(PermissionFlagsBits.ManageGuild),
    reply: options.reply ?? reply.fn,
    update: options.update ?? update.fn,
  } as unknown as ButtonInteraction;
}

function getReplyComponents(reply: AsyncRecorder): unknown[] {
  const firstCall = reply.calls.at(0);
  const firstArg = firstCall?.at(0);

  if (!isRecord(firstArg) || !Array.isArray(firstArg.components)) {
    return [];
  }

  return firstArg.components;
}

function createAsyncRecorder(): AsyncRecorder {
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
