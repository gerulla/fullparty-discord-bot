import { MessageFlags, PermissionFlagsBits, PermissionsBitField } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BotContext } from "../src/bot/context.js";
import { setupCommand } from "../src/commands/setup.js";
import { ScheduleCustomId } from "../src/commands/setupIds.js";
import type { SetupComponentInteraction } from "../src/commands/types.js";
import { SqliteGuildSettingsStore } from "../src/guildSettings/store.js";
import type { GuildSettingsPatch } from "../src/guildSettings/types.js";
import { createInteractionHandler } from "../src/interactions/handleInteraction.js";
import { LatestPayloadStore } from "../src/payloads/latestPayloadStore.js";
import { messageComponents, messageText } from "./helpers/messages.js";

const stores: SqliteGuildSettingsStore[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  stores.splice(0).forEach((store) => {
    store.close();
  });
});

async function fixture(patch: GuildSettingsPatch = {}) {
  const store = new SqliteGuildSettingsStore(":memory:");
  stores.push(store);
  await store.update("guild", {
    runAnnouncementChannelId: "shared-channel",
    syncDiscordNamesToFf14: true,
    ...patch,
  });
  const context: BotContext = {
    guildSettings: store,
    fullparty: {} as BotContext["fullparty"],
    fullpartyWebBaseUrl: "https://fullparty.gg",
    payloads: new LatestPayloadStore(),
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  };
  return { store, handle: createInteractionHandler(context, [setupCommand]) };
}

function interaction(
  kind: "button" | "select" = "button",
  options: {
    permitted?: boolean;
    guild?: boolean;
    customId?: string;
    values?: string[];
  } = {},
) {
  const state = { deferred: false };
  const deferUpdate = vi.fn(() => {
    state.deferred = true;
    return Promise.resolve();
  });
  const editReply = vi.fn<(message: unknown) => Promise<void>>(() => Promise.resolve());
  const reply = vi.fn(() => Promise.resolve());
  const followUp = vi.fn(() => Promise.resolve());
  const value = {
    customId:
      options.customId ??
      (kind === "button" ? ScheduleCustomId.FormatOpen : ScheduleCustomId.FormatValue),
    values: options.values ?? ["expanded"],
    guildId: options.guild === false ? null : "guild",
    client: {},
    user: { id: "manager" },
    createdTimestamp: Date.now(),
    inGuild: () => options.guild !== false,
    memberPermissions: new PermissionsBitField(
      options.permitted === false ? [] : [PermissionFlagsBits.ManageGuild],
    ),
    isChatInputCommand: () => false,
    isButton: () => kind === "button",
    isStringSelectMenu: () => kind === "select",
    isRoleSelectMenu: () => false,
    isChannelSelectMenu: () => false,
    get deferred() {
      return state.deferred;
    },
    replied: false,
    deferUpdate,
    editReply,
    reply,
    followUp,
  } as unknown as SetupComponentInteraction;
  return { value, deferUpdate, editReply, reply, followUp };
}

describe("schedule format interactions", () => {
  it.each(["plain", "expanded", "interactive"] as const)(
    "opens the public preview for stored %s without saving",
    async (scheduleFormat) => {
      const f = await fixture({ scheduleFormat });
      const before = await f.store.get("guild");
      const button = interaction();
      const originalGet = f.store.get.bind(f.store);
      vi.spyOn(f.store, "get").mockImplementation((guildId) => {
        expect(button.deferUpdate).toHaveBeenCalledOnce();
        return originalGet(guildId);
      });
      const update = vi.spyOn(f.store, "update");
      await f.handle(button.value);
      expect(button.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          flags: MessageFlags.IsComponentsV2,
          content: null,
          embeds: [],
        }),
      );
      const selected = scheduleFormat === "expanded" ? "expanded" : "plain";
      expect(messageComponents(button.editReply.mock.calls[0]?.[0])).toContainEqual(
        expect.objectContaining({
          label: "Save",
          custom_id: `${ScheduleCustomId.FormatSave}:${selected}`,
        }),
      );
      expect(messageText(button.editReply.mock.calls[0]?.[0])).toContain("### Preview");
      expect(update).not.toHaveBeenCalled();
      expect(await f.store.get("guild")).toEqual(before);
      expect(button.reply).not.toHaveBeenCalled();
      expect(button.followUp).not.toHaveBeenCalled();
    },
  );

  it("previews dropdown changes and discards the draft on Back", async () => {
    const f = await fixture();
    const update = vi.spyOn(f.store, "update");
    const select = interaction("select");
    await f.handle(select.value);
    const preview = select.editReply.mock.calls[0]?.[0];
    expect(messageText(preview)).toContain("3/48 Participants");
    expect(messageComponents(preview)).toContainEqual(
      expect.objectContaining({
        custom_id: `${ScheduleCustomId.FormatSave}:expanded`,
      }),
    );
    expect(messageText(preview)).not.toContain(":fpclock:");
    const back = interaction("button", { customId: ScheduleCustomId.Open });
    await f.handle(back.value);
    expect(messageText(back.editReply.mock.calls[0]?.[0])).toContain("Schedule Settings");
    expect(messageText(back.editReply.mock.calls[0]?.[0])).toContain("Plain");
    expect(update).not.toHaveBeenCalled();
    await expect(f.store.get("guild")).resolves.toMatchObject({
      scheduleFormat: "plain",
    });
  });

  it.each(["plain", "expanded"] as const)(
    "saves %s and returns to Schedule Settings",
    async (scheduleFormat) => {
      const f = await fixture({
        scheduleFormat: scheduleFormat === "plain" ? "expanded" : "plain",
      });
      const save = interaction("button", {
        customId: `${ScheduleCustomId.FormatSave}:${scheduleFormat}`,
      });
      const originalUpdate = f.store.update.bind(f.store);
      vi.spyOn(f.store, "update").mockImplementation((guildId, patch) => {
        expect(save.deferUpdate).toHaveBeenCalledOnce();
        expect(patch).toEqual({ scheduleFormat });
        return originalUpdate(guildId, patch);
      });
      await f.handle(save.value);
      await expect(f.store.get("guild")).resolves.toMatchObject({
        scheduleFormat,
        runAnnouncementChannelId: "shared-channel",
        syncDiscordNamesToFf14: true,
      });
      expect(messageText(save.editReply.mock.calls[0]?.[0])).toContain(
        "Schedule Settings",
      );
      expect(messageText(save.editReply.mock.calls[0]?.[0])).not.toContain("### Preview");
      expect(save.followUp).not.toHaveBeenCalled();
    },
  );

  it.each([
    { kind: "button", customId: ScheduleCustomId.FormatOpen },
    { kind: "select", customId: ScheduleCustomId.FormatValue },
    { kind: "button", customId: `${ScheduleCustomId.FormatSave}:expanded` },
    { kind: "button", customId: ScheduleCustomId.Open },
  ] as const)("requires Manage Server for $customId", async ({ kind, customId }) => {
    const f = await fixture();
    const get = vi.spyOn(f.store, "get");
    const update = vi.spyOn(f.store, "update");
    const control = interaction(kind, { permitted: false, customId });
    await f.handle(control.value);
    expect(control.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
    expect(control.deferUpdate).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it.each(
    [[], ["unknown"], ["interactive"], ["plain", "expanded"]].map((values) => ({
      values,
    })),
  )("rejects invalid dropdown values $values", async ({ values }) => {
    const f = await fixture();
    const update = vi.spyOn(f.store, "update");
    const select = interaction("select", { values });
    await f.handle(select.value);
    expect(update).not.toHaveBeenCalled();
    expect(select.editReply).not.toHaveBeenCalled();
    expect(select.followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: MessageFlags.Ephemeral,
        content: expect.stringContaining("Choose Plain") as string,
      }),
    );
  });

  it.each([
    { kind: "button", customId: `${ScheduleCustomId.FormatSave}:interactive` },
    { kind: "button", customId: `${ScheduleCustomId.FormatSave}:` },
    { kind: "button", customId: "setup:schedule:format:old" },
    { kind: "select", customId: `${ScheduleCustomId.FormatSave}:expanded` },
    { kind: "button", customId: ScheduleCustomId.FormatValue },
  ] as const)("rejects invalid control $kind $customId", async ({ kind, customId }) => {
    const f = await fixture();
    const update = vi.spyOn(f.store, "update");
    const control = interaction(kind, { customId });
    await f.handle(control.value);
    expect(update).not.toHaveBeenCalled();
    expect(control.editReply).not.toHaveBeenCalled();
    expect(control.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
  });

  it("does not save outside a server", async () => {
    const f = await fixture();
    const update = vi.spyOn(f.store, "update");
    const save = interaction("button", {
      guild: false,
      customId: `${ScheduleCustomId.FormatSave}:expanded`,
    });
    await f.handle(save.value);
    expect(update).not.toHaveBeenCalled();
    expect(save.deferUpdate).not.toHaveBeenCalled();
    expect(save.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
  });

  it("preserves the public preview and reports a failed save privately", async () => {
    const f = await fixture();
    vi.spyOn(f.store, "update").mockRejectedValue(new Error("storage unavailable"));
    const save = interaction("button", {
      customId: `${ScheduleCustomId.FormatSave}:expanded`,
    });
    await f.handle(save.value);
    expect(save.editReply).not.toHaveBeenCalled();
    expect(save.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
    await expect(f.store.get("guild")).resolves.toMatchObject({
      scheduleFormat: "plain",
    });
  });
});
