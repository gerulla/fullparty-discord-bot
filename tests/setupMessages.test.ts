import {
  ButtonStyle,
  ChannelType,
  ComponentType,
  ContainerBuilder,
  MessageFlags,
} from "discord.js";
import { describe, expect, it } from "vitest";
import { buildSetupPanel, type SetupPage } from "../src/discord/setupMessages.js";
import type { GuildSettings } from "../src/guildSettings/types.js";
import { messageComponents, messageText } from "./helpers/messages.js";

const settings: GuildSettings = {
  guildId: "234567890123456789",
  syncDiscordNamesToFf14: false,
  botLogChannelId: "234567890123456780",
  botModeratorRoleId: "234567890123456781",
  upcomingRaiderRoleId: "234567890123456782",
  runAnnouncementChannelId: "234567890123456783",
  scheduleRefreshChannelId: "234567890123456784",
};

describe("setup V2 messages", () => {
  it.each(["home", "bot", "roles", "nickname", "schedule"] satisfies SetupPage[])(
    "uses a mention-safe V2 container for %s",
    (page) => {
      const panel = buildSetupPanel(settings, page);
      expect(panel.flags).toBe(MessageFlags.IsComponentsV2);
      expect(panel.allowedMentions).toEqual({ parse: [], repliedUser: false });
      expect(panel.components).toHaveLength(1);
      expect(panel.components[0]?.type).toBe(ComponentType.Container);
      expect(panel).not.toHaveProperty("embeds");
      expect(panel).not.toHaveProperty("content");
      expect(
        messageComponents(panel).filter((component) => component.label === "Back"),
      ).toHaveLength(page === "home" ? 0 : 1);
    },
  );

  it("uses native role and channel selects with their saved defaults", () => {
    const bot = messageComponents(buildSetupPanel(settings, "bot"));
    expect(bot).toContainEqual(
      expect.objectContaining({
        custom_id: "setup:bot_log_channel",
        type: ComponentType.ChannelSelect,
        channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
        default_values: [{ id: settings.botLogChannelId, type: "channel" }],
      }),
    );
    expect(bot).toContainEqual(
      expect.objectContaining({
        custom_id: "setup:bot_moderator_role",
        type: ComponentType.RoleSelect,
        default_values: [{ id: settings.botModeratorRoleId, type: "role" }],
      }),
    );
    expect(messageComponents(buildSetupPanel(settings, "roles"))).toContainEqual(
      expect.objectContaining({
        custom_id: "setup:upcoming_raider_role",
        type: ComponentType.RoleSelect,
        default_values: [{ id: settings.upcomingRaiderRoleId, type: "role" }],
      }),
    );
  });

  it.each([
    undefined,
    "",
    "not a URL",
    "javascript:alert(1)",
    "https://user:password@fullparty.gg/settings",
    `https://fullparty.gg/${"x".repeat(513)}`,
  ])("omits unavailable or invalid settings links (%s)", (botSettingsUrl) => {
    const panel = buildSetupPanel(settings, "roles", { botSettingsUrl });
    expect(messageComponents(panel).filter((component) => component.url)).toEqual([]);
    expect(messageText(panel)).toContain("Discord integration settings on FullParty");
  });

  it("uses the supplied group settings URL on a link button", () => {
    const url = "https://fullparty.gg/groups/example/dashboard/discord-integration";
    const panel = buildSetupPanel(settings, "roles", { botSettingsUrl: url });
    expect(messageComponents(panel)).toContainEqual(
      expect.objectContaining({
        type: ComponentType.Button,
        style: ButtonStyle.Link,
        label: "Settings",
        url,
      }),
    );
  });

  it("shows valid schedule timestamps and escapes diagnostic Markdown", () => {
    const panel = buildSetupPanel(
      { ...settings, scheduleRefreshEnabled: true },
      "schedule",
      {
        scheduleState: {
          next_refresh_at: "2026-10-10T12:00:00Z",
          last_refreshed_at: "2026-10-09T12:00:00Z",
          last_error: "**failure** [external](https://example.com)",
        },
      },
    );
    const text = messageText(panel);
    expect(text).toContain(`<t:${String(Date.parse("2026-10-10T12:00:00Z") / 1000)}:R>`);
    expect(text).toContain(`<t:${String(Date.parse("2026-10-09T12:00:00Z") / 1000)}:f>`);
    expect(text).toContain("\\*\\*failure\\*\\*");
  });

  it("hides next refresh while disabled and does not render invalid timestamps", () => {
    const state = {
      next_refresh_at: "2026-10-10T12:00:00Z",
      last_refreshed_at: "invalid",
      last_error: null,
    };
    const disabled = messageText(
      buildSetupPanel(settings, "schedule", { scheduleState: state }),
    );
    expect(disabled).not.toContain("Next Refresh");
    expect(disabled).not.toContain("Last Posted");
    const invalid = messageText(
      buildSetupPanel({ ...settings, scheduleRefreshEnabled: true }, "schedule", {
        scheduleState: { ...state, next_refresh_at: "invalid" },
      }),
    );
    expect(invalid).not.toContain("NaN");
    expect(invalid).not.toContain("Next Refresh");
  });

  it.each(["disabled", "timed_refresh", "run_detection"] as const)(
    "uses a single channel and mode-specific controls for %s",
    (scheduleMode) => {
      const panel = buildSetupPanel({ ...settings, scheduleMode }, "schedule");
      const components = messageComponents(panel);
      const channels = components.filter((component) => component.type === 8);
      expect(channels).toHaveLength(1);
      expect(channels[0]).toMatchObject({
        custom_id: "setup:schedule_channel",
        default_values: [{ id: settings.runAnnouncementChannelId, type: "channel" }],
      });
      expect(components).toContainEqual(
        expect.objectContaining({
          custom_id: "setup:schedule:mode",
          options: expect.arrayContaining([
            expect.objectContaining({ value: scheduleMode, default: true }),
          ]) as unknown,
        }),
      );
      expect(
        components.some((component) => component.custom_id === "setup:schedule:interval"),
      ).toBe(scheduleMode === "timed_refresh");
      expect(messageText(panel)).not.toContain(settings.scheduleRefreshChannelId);
      if (scheduleMode === "run_detection") {
        expect(messageText(panel)).toContain("when the website reports");
        expect(messageText(panel)).not.toContain("Refresh Frequency");
      }
    },
  );

  it("shows whether run detection is waiting or has queued work, without a periodic refresh time", () => {
    for (const refresh_pending of [0, 1]) {
      const panel = buildSetupPanel(
        { ...settings, scheduleMode: "run_detection" },
        "schedule",
        {
          scheduleState: {
            next_refresh_at: "2026-10-10T12:00:00Z",
            last_refreshed_at: "2026-10-09T12:00:00Z",
            last_error: null,
            refresh_pending,
          },
        },
      );
      expect(messageText(panel)).toContain(
        refresh_pending ? "Update queued" : "Waiting for run changes",
      );
      expect(messageText(panel)).not.toContain("Next Refresh");
    }
  });

  it("places the format picker between automatic settings and status with large dividers", () => {
    const panel = buildSetupPanel(
      { ...settings, scheduleMode: "run_detection", scheduleFormat: "expanded" },
      "schedule",
      {
        scheduleState: {
          next_refresh_at: "2026-10-10T12:00:00Z",
          last_refreshed_at: null,
          last_error: null,
          refresh_pending: 0,
        },
      },
    );
    const container = panel.components[0];
    if (container?.type !== ComponentType.Container) throw new Error("Missing container");
    expect(() => new ContainerBuilder(container).toJSON()).not.toThrow();
    const formatIndex = container.components.findIndex(
      (component) =>
        component.type === ComponentType.Section &&
        component.accessory.type === ComponentType.Button &&
        "custom_id" in component.accessory &&
        component.accessory.custom_id === "setup:schedule:format:open",
    );
    expect(formatIndex).toBeGreaterThan(0);
    expect(container.components[formatIndex - 1]).toEqual({
      type: ComponentType.Separator,
      divider: true,
      spacing: 2,
    });
    expect(container.components[formatIndex + 1]).toEqual({
      type: ComponentType.Separator,
      divider: true,
      spacing: 2,
    });
    expect(container.components[formatIndex + 2]).toMatchObject({
      type: ComponentType.TextDisplay,
      content: "**Status:** Waiting for run changes",
    });
    expect(messageText(panel)).toContain("Current: Expanded");
    expect(messageText(panel).indexOf("**Automatic Schedule**")).toBeLessThan(
      messageText(panel).indexOf("**Schedule Format**"),
    );
  });

  it("keeps the format picker available when automatic schedules are disabled", () => {
    const panel = buildSetupPanel({ ...settings, scheduleMode: "disabled" }, "schedule");
    expect(messageText(panel)).toContain("Current: Plain");
    expect(messageComponents(panel)).toContainEqual(
      expect.objectContaining({
        label: "Pick Format",
        custom_id: "setup:schedule:format:open",
      }),
    );
  });

  it.each(["home", "bot", "roles", "nickname", "schedule"] satisfies SetupPage[])(
    "keeps long dynamic content within Discord message limits on %s",
    (page) => {
      const panel = buildSetupPanel(
        {
          ...settings,
          scheduleRefreshEnabled: true,
          runRoleTemplateOverrides: Array.from({ length: 100 }, (_, index) => ({
            activityId: index + 1,
            activityName: "*".repeat(1000),
            roleId: "234567890123456781",
          })),
        },
        page,
        {
          warning: "w".repeat(10000),
          scheduleState: {
            next_refresh_at: "2026-10-10T12:00:00Z",
            last_refreshed_at: "2026-10-09T12:00:00Z",
            last_error: "*".repeat(10000),
          },
          botSettingsUrl:
            "https://fullparty.gg/groups/example/dashboard/discord-integration",
        },
      );
      const components = messageComponents(panel);
      expect(components.length).toBeLessThanOrEqual(40);
      expect(
        components.reduce(
          (length, component) => length + (component.content?.length ?? 0),
          0,
        ),
      ).toBeLessThanOrEqual(4000);
      expect(messageText(panel)).not.toContain("w".repeat(601));
      if (page === "roles") {
        expect(messageText(panel)).toContain("92 more");
        expect(messageText(panel)).toContain("\\*");
      }
    },
  );
});
