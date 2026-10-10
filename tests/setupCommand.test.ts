import {
  ComponentType,
  MessageFlags,
  PermissionFlagsBits,
  PermissionsBitField,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type ChatInputCommandInteraction,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { describe, expect, it, vi } from "vitest";

import type { BotContext } from "../src/bot/context.js";
import { setupCommand } from "../src/commands/setup.js";
import { FullpartyApiClient } from "../src/fullparty/client.js";
import type { GuildSettings, GuildSettingsPatch } from "../src/guildSettings/types.js";
import { createInteractionHandler } from "../src/interactions/handleInteraction.js";
import { LatestPayloadStore } from "../src/payloads/latestPayloadStore.js";
import { messageComponents, messageText } from "./helpers/messages.js";

const navigation = [
  { id: "setup:page:bot", label: "Bot Settings", control: "setup:bot_log_channel" },
  {
    id: "setup:page:roles",
    label: "Role Templates",
    control: "setup:upcoming_raider_role",
  },
  {
    id: "setup:page:nickname",
    label: "Nickname Sync",
    control: "setup:name_sync:enabled",
  },
  {
    id: "setup:schedule:open",
    label: "Schedule Settings",
    control: "setup:schedule:mode",
  },
];

describe("setupCommand", () => {
  it("immediately opens a public V2 menu with four sections, without loading settings", async () => {
    const context = createContext();
    const get = vi.fn(() => {
      throw new Error("The home menu must not wait for settings.");
    });
    context.guildSettings.get = get;
    const reply = createAsyncRecorder();
    await setupCommand.execute(createChatInputInteraction({ reply: reply.fn }), context);
    expect(reply.calls).toHaveLength(1);
    const message = response(reply);
    expect(message).toMatchObject({
      flags: MessageFlags.IsComponentsV2,
    });
    expect(messageText(message)).toContain("FullParty Server Setup");
    expect(
      messageComponents(message)
        .filter((c) => c.type === 2)
        .map(({ custom_id, label }) => ({ custom_id, label })),
    ).toEqual(navigation.map(({ id, label }) => ({ custom_id: id, label })));
    expect(messageComponents(message).some((c) => c.type === 8)).toBe(false);
    expect(get).not.toHaveBeenCalled();
    expect(context.patches).toEqual([]);
  });

  it.each(navigation)(
    "opens only $label and returns to the menu without changing settings",
    async ({ id, label, control }) => {
      const context = createContext();
      const editReply = createAsyncRecorder();
      const deferUpdate = createAsyncRecorder();
      await setupCommand.handleComponent?.(
        createComponentInteraction("button", {
          customId: id,
          editReply: editReply.fn,
          deferUpdate: deferUpdate.fn,
        }),
        context,
      );
      expectV2Edit(response(editReply));
      expect(messageText(response(editReply))).toContain(`## ${label}`);
      expect(customIds(response(editReply))).toContain(control);
      expect(customIds(response(editReply))).toContain("setup:back");
      for (const other of navigation.filter((item) => item.id !== id)) {
        expect(customIds(response(editReply))).not.toContain(other.control);
      }
      await setupCommand.handleComponent?.(
        createComponentInteraction("button", {
          customId: "setup:back",
          editReply: editReply.fn,
          deferUpdate: deferUpdate.fn,
        }),
        context,
      );
      expectV2Edit(response(editReply, 1));
      expect(customIds(response(editReply, 1))).toEqual(
        navigation.map((item) => item.id),
      );
      expect(deferUpdate.calls).toHaveLength(2);
      expect(context.patches).toEqual([]);
    },
  );

  it("lists configured template role overrides on the role page", async () => {
    const context = createContext({
      runRoleTemplateOverrides: [
        { activityId: 321, activityName: "Abyssos Savage", roleId: "abyssos-role-id" },
        { activityId: 654, activityName: "Eden Ultimate", roleId: "eden-role-id" },
      ],
    });
    const editReply = createAsyncRecorder();
    await setupCommand.handleComponent?.(
      createComponentInteraction("button", {
        customId: "setup:page:roles",
        editReply: editReply.fn,
      }),
      context,
    );
    const text = messageText(response(editReply));
    expect(text).toContain("Abyssos Savage");
    expect(text).toContain("<@&abyssos-role-id>");
    expect(text).toContain("Eden Ultimate");
    expect(text).toContain("<@&eden-role-id>");
    expect(messageComponents(response(editReply))).toContainEqual(
      expect.objectContaining({
        type: ComponentType.RoleSelect,
        custom_id: "setup:upcoming_raider_role",
      }),
    );
  });

  it.each([undefined, "example-raiders"])(
    "links role settings only when the linked group slug is known (%s)",
    async (groupSlug) => {
      const context = createContext(groupSlug ? { groupSlug } : {});
      const editReply = createAsyncRecorder();
      await setupCommand.handleComponent?.(
        createComponentInteraction("button", {
          customId: "setup:page:roles",
          editReply: editReply.fn,
        }),
        context,
      );
      const links = messageComponents(response(editReply)).filter(
        (component) => component.url,
      );
      expect(links).toEqual(
        groupSlug
          ? [
              expect.objectContaining({
                label: "Settings",
                url: "https://fullparty.gg/groups/example-raiders/dashboard/discord-integration",
              }),
            ]
          : [],
      );
      expect(context.patches).toEqual([]);
    },
  );

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
        memberPermissions: new PermissionsBitField(),
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

  it.each([
    {
      kind: "channel",
      id: "setup:bot_log_channel",
      value: "bot-log-channel-id",
      patch: { botLogChannelId: "bot-log-channel-id" },
      ownControl: "setup:bot_moderator_role",
    },
    {
      kind: "role",
      id: "setup:bot_moderator_role",
      value: "bot-moderator-role-id",
      patch: { botModeratorRoleId: "bot-moderator-role-id" },
      ownControl: "setup:bot_log_channel",
    },
    {
      kind: "role",
      id: "setup:upcoming_raider_role",
      value: "upcoming-raider-role-id",
      patch: { upcomingRaiderRoleId: "upcoming-raider-role-id" },
      ownControl: "setup:upcoming_raider_role",
    },
  ] as const)(
    "saves $id and refreshes its own section",
    async ({ kind, id, value, patch, ownControl }) => {
      const context = createContext();
      const editReply = createAsyncRecorder();
      await setupCommand.handleComponent?.(
        createComponentInteraction(kind, {
          customId: id,
          editReply: editReply.fn,
          values: [value],
        }),
        context,
      );
      expect(context.patches).toEqual([patch]);
      expectV2Edit(response(editReply));
      expect(messageText(response(editReply))).toContain(value);
      expect(customIds(response(editReply))).toContain(ownControl);
      expect(customIds(response(editReply))).not.toContain("setup:schedule:channel");
      expect(customIds(response(editReply))).toContain("setup:back");
    },
  );

  it.each([
    "setup:schedule_channel",
    "setup:run_announcement_channel",
    "setup:schedule:channel",
  ])(
    "updates the shared schedule channel using current and legacy control %s",
    async (customId) => {
      const context = createContext({ scheduleRefreshChannelId: "automatic-channel" });
      const editReply = createAsyncRecorder();
      await setupCommand.handleComponent?.(
        createComponentInteraction("channel", {
          customId,
          editReply: editReply.fn,
          values: ["manual-channel"],
        }),
        context,
      );
      expect(context.patches).toEqual([{ runAnnouncementChannelId: "manual-channel" }]);
      expectV2Edit(response(editReply));
      expect(messageText(response(editReply))).toContain("<#manual-channel>");
      expect(messageText(response(editReply))).not.toContain("<#automatic-channel>");
      expect(customIds(response(editReply))).toContain("setup:schedule_channel");
      expect(customIds(response(editReply))).not.toContain("setup:schedule:channel");
      expect(customIds(response(editReply))).not.toContain(
        "setup:run_announcement_channel",
      );
    },
  );

  it("warns when a selected manual schedule channel is missing send permissions", async () => {
    const context = createContext();
    const editReply = createAsyncRecorder();
    await setupCommand.handleComponent?.(
      createComponentInteraction("channel", {
        channel: {
          permissionsFor: () => new PermissionsBitField(PermissionFlagsBits.ViewChannel),
        },
        customId: "setup:schedule_channel",
        editReply: editReply.fn,
        values: ["manual-channel"],
      }),
      context,
    );
    expect(context.patches).toEqual([{ runAnnouncementChannelId: "manual-channel" }]);
    expect(messageText(response(editReply))).toContain(
      "Schedule Channel preflight: I cannot fully send messages",
    );
    expect(messageText(response(editReply))).toContain("Send Messages, Embed Links");
  });

  it("does not warn when a selected bot-log channel is sendable", async () => {
    const editReply = createAsyncRecorder();
    await setupCommand.handleComponent?.(
      createComponentInteraction("channel", {
        channel: {
          permissionsFor: () =>
            new PermissionsBitField([
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.EmbedLinks,
            ]),
        },
        customId: "setup:bot_log_channel",
        editReply: editReply.fn,
      }),
      createContext(),
    );
    expect(messageText(response(editReply))).not.toContain("preflight");
  });

  it("updates nickname state and offers the inverse toggle after each change", async () => {
    const context = createContext();
    const editReply = createAsyncRecorder();
    for (const [index, enabled] of [true, false].entries()) {
      await setupCommand.handleComponent?.(
        createComponentInteraction("button", {
          customId: `setup:name_sync:${enabled ? "enabled" : "disabled"}`,
          editReply: editReply.fn,
        }),
        context,
      );
      const message = response(editReply, index);
      expectV2Edit(message);
      expect(messageText(message)).toContain(enabled ? "Enabled" : "Disabled");
      expect(customIds(message)).toContain(
        `setup:name_sync:${enabled ? "disabled" : "enabled"}`,
      );
      expect(customIds(message)).not.toContain("setup:bot_log_channel");
      expect(customIds(message)).not.toContain("setup:schedule:channel");
    }
    expect(context.patches).toEqual([
      { syncDiscordNamesToFf14: true },
      { syncDiscordNamesToFf14: false },
    ]);
  });

  it.each([1, 2, 3, 4, 5, 6, 7])(
    "routes the frequency select and saves %i days on the schedule page",
    async (days) => {
      const context = createContext({ scheduleMode: "timed_refresh" });
      const editReply = createAsyncRecorder();
      const interaction = createComponentInteraction("string", {
        customId: "setup:schedule:interval",
        editReply: editReply.fn,
        values: [String(days)],
      });
      await createInteractionHandler(context, [setupCommand])(interaction);
      expect(context.patches).toEqual([{ scheduleRefreshIntervalDays: days }]);
      expect(editReply.calls).toHaveLength(1);
      expectV2Edit(response(editReply));
      expect(messageComponents(response(editReply))).toContainEqual(
        expect.objectContaining({
          custom_id: "setup:schedule:interval",
          options: expect.arrayContaining([
            expect.objectContaining({ value: String(days), default: true }),
          ]) as unknown,
        }),
      );
    },
  );

  it("warns about history permission when selecting a shared automatic schedule channel", async () => {
    const context = createContext({ scheduleMode: "run_detection" });
    const editReply = createAsyncRecorder();
    await setupCommand.handleComponent?.(
      createComponentInteraction("channel", {
        customId: "setup:schedule:channel",
        values: ["schedule-channel"],
        editReply: editReply.fn,
        channel: {
          permissionsFor: () =>
            new PermissionsBitField([
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.EmbedLinks,
            ]),
        },
      }),
      context,
    );
    expect(context.patches).toEqual([{ runAnnouncementChannelId: "schedule-channel" }]);
    expect(messageText(response(editReply))).toContain("Read Message History");
    expect(messageText(response(editReply))).not.toContain("Embed Links");
    expect(messageText(response(editReply))).toContain("<#schedule-channel>");
  });

  it.each([false, true])(
    "requires a link and a chosen channel before enabling schedules (linked: %s)",
    async (linked) => {
      const context = createContext(linked ? { linkedAt: "2026-09-11T00:00:00Z" } : {});
      const editReply = createAsyncRecorder();
      await setupCommand.handleComponent?.(
        createComponentInteraction("button", {
          customId: "setup:schedule:enable",
          editReply: editReply.fn,
        }),
        context,
      );
      expect(context.patches).toEqual([]);
      expectV2Edit(response(editReply));
      expect(messageText(response(editReply))).toContain(
        linked ? "Choose a schedule channel" : "Link this server",
      );
    },
  );

  it("keeps legacy enable and disable controls working with the new modes", async () => {
    const context = createContext({
      linkedAt: "2026-09-11T00:00:00Z",
      runAnnouncementChannelId: "schedule-channel",
    });
    const editReply = createAsyncRecorder();
    for (const [index, enabled] of [true, false].entries()) {
      await setupCommand.handleComponent?.(
        createComponentInteraction("button", {
          customId: `setup:schedule:${enabled ? "enable" : "disable"}`,
          editReply: editReply.fn,
        }),
        context,
      );
      expect(messageComponents(response(editReply, index))).toContainEqual(
        expect.objectContaining({
          custom_id: "setup:schedule:mode",
          options: expect.arrayContaining([
            expect.objectContaining({
              value: enabled ? "timed_refresh" : "disabled",
              default: true,
            }),
          ]) as unknown,
        }),
      );
    }
    expect(context.patches).toEqual([
      { scheduleMode: "timed_refresh" },
      { scheduleMode: "disabled" },
    ]);
  });

  it("switches between all three modes and only shows the frequency control for timed refresh", async () => {
    const context = createContext({
      linkedAt: "2026-09-11T00:00:00Z",
      runAnnouncementChannelId: "schedule-channel",
    });
    const editReply = createAsyncRecorder();
    const modes = ["timed_refresh", "run_detection", "disabled"] as const;
    for (const [index, mode] of modes.entries()) {
      await createInteractionHandler(context, [setupCommand])(
        createComponentInteraction("string", {
          customId: "setup:schedule:mode",
          values: [mode],
          editReply: editReply.fn,
        }),
      );
      expectV2Edit(response(editReply, index));
      expect(
        customIds(response(editReply, index)).includes("setup:schedule:interval"),
      ).toBe(mode === "timed_refresh");
      expect(customIds(response(editReply, index))).toContain("setup:schedule_channel");
      expect(customIds(response(editReply, index))).not.toContain(
        "setup:schedule:channel",
      );
      expect(messageComponents(response(editReply, index))).toContainEqual(
        expect.objectContaining({
          custom_id: "setup:schedule:mode",
          options: expect.arrayContaining([
            expect.objectContaining({ value: mode, default: true }),
          ]) as unknown,
        }),
      );
    }
    expect(context.patches).toEqual(modes.map((scheduleMode) => ({ scheduleMode })));
  });

  it.each(["timed_refresh", "run_detection"])(
    "requires a linked server and shared channel when selecting %s",
    async (mode) => {
      for (const linked of [false, true]) {
        const context = createContext({
          ...(linked ? { linkedAt: "2026-09-11T00:00:00Z" } : {}),
          scheduleRefreshChannelId: "old-automatic-channel",
        });
        const editReply = createAsyncRecorder();
        await setupCommand.handleComponent?.(
          createComponentInteraction("string", {
            customId: "setup:schedule:mode",
            values: [mode],
            editReply: editReply.fn,
          }),
          context,
        );
        expect(context.patches).toEqual([]);
        expect(messageText(response(editReply))).toContain(
          linked ? "Choose a schedule channel" : "Link this server",
        );
      }
    },
  );

  it("checks channel history permission when activating automatic updates", async () => {
    const context = createContext({
      linkedAt: "2026-09-11T00:00:00Z",
      runAnnouncementChannelId: "schedule-channel",
    });
    const editReply = createAsyncRecorder();
    await setupCommand.handleComponent?.(
      createComponentInteraction("string", {
        customId: "setup:schedule:mode",
        values: ["run_detection"],
        editReply: editReply.fn,
        channel: {
          permissionsFor: () =>
            new PermissionsBitField([
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.EmbedLinks,
            ]),
        },
      }),
      context,
    );
    expect(context.patches).toEqual([{ scheduleMode: "run_detection" }]);
    expect(messageText(response(editReply))).toContain("Read Message History");
  });

  it("rejects invalid schedule mode values without changing settings", async () => {
    const context = createContext();
    await expect(
      setupCommand.handleComponent?.(
        createComponentInteraction("string", {
          customId: "setup:schedule:mode",
          values: ["invalid-mode"],
        }),
        context,
      ),
    ).rejects.toThrow("Choose a valid schedule mode");
    expect(context.patches).toEqual([]);
  });

  it.each([
    "setup:page:bot",
    "setup:page:roles",
    "setup:page:nickname",
    "setup:schedule:open",
    "setup:back",
    "setup:name_sync:enabled",
    "setup:schedule:disable",
  ])("rechecks Manage Server before acknowledging or loading %s", async (customId) => {
    const context = createContext();
    const get = vi.spyOn(context.guildSettings, "get");
    const reply = createAsyncRecorder();
    const deferUpdate = createAsyncRecorder();
    const editReply = createAsyncRecorder();
    await setupCommand.handleComponent?.(
      createComponentInteraction("button", {
        customId,
        memberPermissions: new PermissionsBitField(),
        reply: reply.fn,
        deferUpdate: deferUpdate.fn,
        editReply: editReply.fn,
      }),
      context,
    );
    expect(context.patches).toEqual([]);
    expect(get).not.toHaveBeenCalled();
    expect(deferUpdate.calls).toEqual([]);
    expect(editReply.calls).toEqual([]);
    expect(JSON.stringify(reply.calls)).toContain("Manage Server");
  });

  it("acknowledges navigation before waiting on settings", async () => {
    const context = createContext();
    let acknowledged = false;
    const get = context.guildSettings.get.bind(context.guildSettings);
    context.guildSettings.get = (guildId) => {
      expect(acknowledged).toBe(true);
      return get(guildId);
    };
    await setupCommand.handleComponent?.(
      createComponentInteraction("button", {
        customId: "setup:page:bot",
        deferUpdate: () => {
          acknowledged = true;
          return Promise.resolve();
        },
      }),
      context,
    );
    expect(acknowledged).toBe(true);
  });

  it("acknowledges a setting change before permission checks and persistence", async () => {
    const context = createContext();
    let acknowledged = false;
    const update = context.guildSettings.update.bind(context.guildSettings);
    context.guildSettings.update = (guildId, patch) => {
      expect(acknowledged).toBe(true);
      return update(guildId, patch);
    };
    const permissionsFor = vi.fn(() => {
      expect(acknowledged).toBe(true);
      return new PermissionsBitField();
    });
    await setupCommand.handleComponent?.(
      createComponentInteraction("channel", {
        customId: "setup:bot_log_channel",
        channel: { permissionsFor },
        deferUpdate: () => {
          acknowledged = true;
          return Promise.resolve();
        },
      }),
      context,
    );
    expect(permissionsFor).toHaveBeenCalled();
    expect(context.patches).toEqual([{ botLogChannelId: "selected-id" }]);
  });
});

type TestContext = BotContext & { patches: GuildSettingsPatch[] };
type AsyncRecorder = { calls: unknown[][]; fn: (...args: unknown[]) => Promise<void> };
type BaseInteractionOptions = {
  guildId?: string | null;
  inGuild?: () => boolean;
  memberPermissions?: PermissionsBitField;
  reply?: (...args: unknown[]) => Promise<void>;
};
type ComponentInteractionOptions = BaseInteractionOptions & {
  channel?: unknown;
  customId: string;
  deferUpdate?: (...args: unknown[]) => Promise<void>;
  editReply?: (...args: unknown[]) => Promise<void>;
  values?: string[];
};

function createContext(initialSettings: Partial<GuildSettings> = {}): TestContext {
  let settings: GuildSettings = {
    guildId: "guild-id",
    syncDiscordNamesToFf14: false,
    ...initialSettings,
  };
  const patches: GuildSettingsPatch[] = [];
  return {
    fullparty: new FullpartyApiClient({
      baseUrl: "https://api.fullparty.gg",
      fetcher: () => Promise.resolve(new Response(null, { status: 204 })),
    }),
    fullpartyWebBaseUrl: "https://fullparty.gg",
    guildSettings: {
      get: (guildId) => Promise.resolve({ ...settings, guildId }),
      update: (guildId, patch) => {
        patches.push(patch);
        const values = Object.fromEntries(
          Object.entries({ ...settings, ...patch, guildId }).filter(
            ([, value]) => value !== null,
          ),
        );
        settings = values as GuildSettings;
        return Promise.resolve({ ...settings });
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

function createChatInputInteraction(
  options: BaseInteractionOptions = {},
): ChatInputCommandInteraction {
  return {
    guildId: options.guildId === undefined ? "guild-id" : options.guildId,
    inGuild: options.inGuild ?? (() => true),
    memberPermissions:
      options.memberPermissions ??
      new PermissionsBitField(PermissionFlagsBits.ManageGuild),
    reply: options.reply ?? createAsyncRecorder().fn,
  } as unknown as ChatInputCommandInteraction;
}

function createComponentInteraction(
  kind: "button" | "channel" | "role" | "string",
  options: ComponentInteractionOptions,
):
  | ButtonInteraction
  | ChannelSelectMenuInteraction
  | RoleSelectMenuInteraction
  | StringSelectMenuInteraction {
  return {
    customId: options.customId,
    guildId: options.guildId === undefined ? "guild-id" : options.guildId,
    inGuild: options.inGuild ?? (() => true),
    isChatInputCommand: () => false,
    isButton: () => kind === "button",
    isChannelSelectMenu: () => kind === "channel",
    isRoleSelectMenu: () => kind === "role",
    isStringSelectMenu: () => kind === "string",
    memberPermissions:
      options.memberPermissions ??
      new PermissionsBitField(PermissionFlagsBits.ManageGuild),
    channels: { get: () => options.channel },
    guild: { members: { me: { id: "bot-user-id" } } },
    reply: options.reply ?? createAsyncRecorder().fn,
    deferUpdate: options.deferUpdate ?? createAsyncRecorder().fn,
    editReply: options.editReply ?? createAsyncRecorder().fn,
    values: options.values ?? ["selected-id"],
    user: { id: "manager" },
  } as unknown as ButtonInteraction;
}

function response(recorder: AsyncRecorder, index = 0): unknown {
  return recorder.calls[index]?.[0];
}

function customIds(message: unknown): string[] {
  return messageComponents(message).flatMap((component) =>
    component.custom_id ? [component.custom_id] : [],
  );
}

function expectV2Edit(message: unknown): void {
  expect(message).toMatchObject({
    flags: MessageFlags.IsComponentsV2,
    content: null,
    embeds: [],
  });
  expect(messageComponents(message).some((component) => component.type === 17)).toBe(
    true,
  );
  expect(customIds(message).every((id) => id.startsWith("setup:"))).toBe(true);
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
