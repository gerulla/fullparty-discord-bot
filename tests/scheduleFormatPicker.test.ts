import { ButtonStyle, ComponentType, ContainerBuilder, MessageFlags } from "discord.js";
import { describe, expect, it } from "vitest";
import { ScheduleCustomId } from "../src/commands/setupIds.js";
import {
  buildScheduleFormatPicker,
  schedulePreviewResponse,
} from "../src/discord/scheduleFormatPicker.js";
import { resolveV2MessageIcons } from "../src/discord/v2.js";
import { createGuildUpcomingRunsPostMessage } from "../src/fullparty/discordGuildRunPosts.js";
import type { ScheduleFormat } from "../src/guildSchedule/settings.js";
import { messageComponents, messageText } from "./helpers/messages.js";

describe("schedule format picker", () => {
  it("starts with Plain and only offers the implemented formats", () => {
    const message = buildScheduleFormatPicker();
    const select = messageComponents(message).find(
      (component) => component.custom_id === ScheduleCustomId.FormatValue,
    );
    expect(select).toEqual({
      type: ComponentType.StringSelect,
      custom_id: ScheduleCustomId.FormatValue,
      min_values: 1,
      max_values: 1,
      options: [
        { label: "Plain", value: "plain", default: true },
        { label: "Expanded", value: "expanded", default: false },
      ],
    });
  });

  it("previews the actual Plain schedule without changing its contents", () => {
    const message = buildScheduleFormatPicker("plain");
    const preview = createGuildUpcomingRunsPostMessage(
      schedulePreviewResponse,
      "https://fullparty.gg",
      "plain",
    );
    expect(message.components.slice(2, -2)).toEqual([
      { type: ComponentType.TextDisplay, content: preview.content },
    ]);
    expect(messageText(message)).toContain("3/48 Participants - 1 Applications");
    expect(messageText(message)).toContain("Giki Chomusuke [Lich]");
    expect(messageText(message)).toContain("Sample run — not a live listing.");
  });

  it("previews the actual Expanded cards with Giki's Lodestone profile image", () => {
    const message = buildScheduleFormatPicker("expanded");
    const preview = createGuildUpcomingRunsPostMessage(
      schedulePreviewResponse,
      "https://fullparty.gg",
      "expanded",
    );
    expect(message.components.slice(2, -2)).toEqual(preview.components);
    expect(messageComponents(message)).toContainEqual(
      expect.objectContaining({
        type: ComponentType.Thumbnail,
        media: {
          url: "https://img2.finalfantasyxiv.com/f/15cff6ad5af687333d4ae7545c7b4ec4_7206469080400ed57a5373d0a9c55c59fc0.jpg?1791650372",
        },
        description: "Host profile picture",
      }),
    );
    expect(messageText(message)).toContain("**Scheduled Start:** <t:");
    expect(messageText(message)).toContain("3/48 Participants - 1 Application(s)");
    expect(messageText(message)).toContain("Giki Chomusuke [Lich]");
    expect(messageComponents(message)).toContainEqual(
      expect.objectContaining({
        type: ComponentType.StringSelect,
        options: [
          { label: "Plain", value: "plain", default: false },
          { label: "Expanded", value: "expanded", default: true },
        ],
      }),
    );
  });

  it.each(["plain", "expanded"] satisfies ScheduleFormat[])(
    "keeps the %s draft in Save and sends Back to the schedule settings",
    (format) => {
      const message = buildScheduleFormatPicker(format);
      expect(message.components.at(-2)).toEqual({
        type: ComponentType.Separator,
        spacing: 2,
        divider: true,
      });
      expect(message.components.at(-1)).toEqual({
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.Button,
            style: ButtonStyle.Secondary,
            label: "Back",
            custom_id: ScheduleCustomId.Open,
          },
          {
            type: ComponentType.Button,
            style: ButtonStyle.Success,
            label: "Save",
            custom_id: `${ScheduleCustomId.FormatSave}:${format}`,
          },
        ],
      });
      expect(messageText(message)).toContain("applied only when you save");
    },
  );

  it("maps an older Interactive preference to the available Plain draft", () => {
    expect(buildScheduleFormatPicker("interactive")).toEqual(
      buildScheduleFormatPicker("plain"),
    );
  });

  it.each(["plain", "expanded"] satisfies ScheduleFormat[])(
    "uses a public, mention-safe V2 message and fits Discord's limits for %s",
    (format) => {
      const message = buildScheduleFormatPicker(format);
      expect(message.flags).toBe(MessageFlags.IsComponentsV2);
      expect(message.flags & MessageFlags.Ephemeral).toBe(0);
      expect(message.allowedMentions).toEqual({ parse: [], repliedUser: false });
      expect(message).not.toHaveProperty("content");
      expect(message).not.toHaveProperty("embeds");
      for (const component of message.components) {
        if (component.type === ComponentType.Container) {
          expect(() => new ContainerBuilder(component).toJSON()).not.toThrow();
        }
      }
      const resolved = resolveV2MessageIcons(message, {
        emojis: {
          cache: new Map(
            ["fpclock", "fpnametag", "fpatsymbol"].map((name) => [
              name,
              { name, id: "12345678901234567890", animated: true },
            ]),
          ),
        },
      });
      const components = messageComponents(resolved);
      expect(components.length).toBeLessThanOrEqual(40);
      expect(
        components.reduce(
          (length, component) => length + (component.content?.length ?? 0),
          0,
        ),
      ).toBeLessThanOrEqual(4000);
      const ids = components.map((component) => component.custom_id).filter(Boolean);
      expect(new Set(ids).size).toBe(ids.length);
    },
  );
});
