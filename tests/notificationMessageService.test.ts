import type { APIEmbed, MessageCreateOptions } from "discord.js";
import { describe, expect, it } from "vitest";

import {
  getSupportedNotificationTypes,
  NotificationMessageService,
} from "../src/notifications/notificationMessageService.js";
import type { NotificationDeliveryData } from "../src/notifications/types.js";
import { messageComponents, messageText } from "./helpers/messages.js";

describe("NotificationMessageService", () => {
  it("has copy for current Discord-delivered notification types", () => {
    expect(getSupportedNotificationTypes()).toEqual(
      expect.arrayContaining([
        "user.discord_login",
        "user.social_account.linked",
        "user.social_account.unlinked",
        "applications.new_for_review",
        "applications.submitted",
        "applications.updated",
        "applications.withdrawn",
        "applications.declined",
        "applications.cancelled",
        "characters.added",
        "characters.primary_changed",
        "characters.unclaimed",
        "assignments.roster_published_assigned",
        "assignments.roster_published_bench",
        "assignments.assigned",
        "assignments.on_bench",
        "assignments.returned_to_queue",
        "assignments.marked_missing",
        "assignments.missing_restored",
        "assignments.designation_assigned",
        "assignments.designation_removed",
        "runs.cancelled",
        "runs.completed",
        "runs.starting_soon",
        "runs.starting_now",
        "runs.party_finder_published",
        "system.maintenance.upcoming",
        "system.announcement",
      ]),
    );
  });

  it("keeps Discord login onboarding steps visible and links to the website's setup page", () => {
    const service = new NotificationMessageService({
      fullpartyWebBaseUrl: "https://fullparty.gg",
    });
    const actionUrl = "https://fullparty.gg/en/settings/discord";
    const message = service.createDmMessage(
      createNotificationDelivery({
        actionUrl,
        category: "account_character_updates",
        type: "user.discord_login",
        payload: { account_settings_url: "/en/settings/notifications" },
      }),
    );

    expect(message.flags).toBe(32768);
    expect(message.embeds).toBeUndefined();
    expect(message.content).toBeUndefined();
    expect(messageText(message)).toContain("Welcome to FullParty");
    expect(messageText(message)).toMatch(/signed in.*Discord/iu);
    expect(messageText(message)).toContain("Automated Setup");
    expect(messageText(message)).toContain("Manual Setup");
    expect(messageText(message)).toMatch(/authorize the FullParty/iu);
    expect(messageText(message)).toContain("`/link token:<code>`");
    expect(messageComponents(message)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Finish Discord Setup",
          style: 5,
          type: 2,
          url: actionUrl,
        }),
        expect.objectContaining({
          label: "Account Settings",
          url: "https://fullparty.gg/en/settings/notifications",
        }),
      ]),
    );
  });

  it("renders Discord login onboarding without an optional setup URL", () => {
    const service = new NotificationMessageService({
      fullpartyWebBaseUrl: "https://test.fullparty.gg",
    });
    const data = createNotificationDelivery({
      actionUrl: "https://fullparty.gg/en/settings/discord",
      category: "account_character_updates",
      type: "user.discord_login",
    });
    delete data.notification.action_url;

    const message = service.createDmMessage(data);

    expect(message.flags).toBe(32768);
    expect(message.embeds).toBeUndefined();
    expect(messageText(message)).toContain("Welcome to FullParty");
    expect(messageText(message)).toContain("Manual Setup");
    expect(messageComponents(message)).toContainEqual(
      expect.objectContaining({
        label: "Finish Discord Setup",
        url: "https://test.fullparty.gg/auth/discord-app/user/redirect",
      }),
    );
  });

  it("omits unsafe Discord login presentation links without dropping the message", () => {
    const service = new NotificationMessageService({
      fullpartyWebBaseUrl: "https://fullparty.gg",
    });
    const message = service.createDmMessage(
      createNotificationDelivery({
        actionUrl: "javascript:alert(1)",
        category: "account_character_updates",
        type: "user.discord_login",
        payload: { account_settings_url: "https://user:password@fullparty.gg/settings" },
      }),
    );

    expect(message.flags).toBe(32768);
    expect(messageText(message)).toContain("Welcome to FullParty");
    expect(JSON.stringify(message)).not.toContain("javascript:");
    expect(JSON.stringify(message)).not.toContain("user:password");
  });

  it("includes social account providers when present", () => {
    const service = new NotificationMessageService({
      fullpartyWebBaseUrl: "https://fullparty.gg",
    });

    expectNotificationMessage(
      service.createDmMessage(
        createNotificationDelivery({
          actionUrl: "http://fullparty.test/en/settings",
          category: "account_character_updates",
          params: {
            provider: "Discord",
          },
          payload: {
            provider: "discord",
          },
          type: "user.social_account.linked",
        }),
      ),
      {
        actionLabel: "Review account connections",
        actionUrl: "http://fullparty.test/en/settings",
        color: 0x22c55e,
        description: "Discord was linked to your FullParty account.",
        footerText: "👤 FullParty • Account Character Updates",
        title: "Discord account linked",
      },
    );
  });

  it("includes character details when present", () => {
    const service = new NotificationMessageService({
      fullpartyWebBaseUrl: "https://fullparty.gg",
    });

    expectNotificationMessage(
      service.createDmMessage(
        createNotificationDelivery({
          actionUrl: "http://fullparty.test/en/account/characters",
          category: "account_character_updates",
          params: {
            character: "Giki Chomusuke",
            datacenter: "Light",
            method: "XIVAuth",
            world: "Lich",
          },
          payload: {
            character_id: 321,
            lodestone_id: "47431834",
            method: "xivauth",
          },
          type: "characters.added",
        }),
      ),
      {
        actionLabel: "View characters",
        actionUrl: "http://fullparty.test/en/account/characters",
        color: 0x22c55e,
        description:
          "Giki Chomusuke (Lich, Light) was added to your FullParty account via XIVAuth.",
        footerText: "👤 FullParty • Account Character Updates",
        title: "Character added",
      },
    );
  });

  it("renders unknown notification types with a readable fallback", () => {
    const service = new NotificationMessageService({
      fullpartyWebBaseUrl: "https://fullparty.gg",
    });

    expectNotificationMessage(
      service.createDmMessage(
        createNotificationDelivery({
          actionUrl: "https://fullparty.gg/notifications",
          category: "custom_events",
          type: "something.custom_happened",
        }),
      ),
      {
        actionLabel: "Open in FullParty",
        actionUrl: "https://fullparty.gg/notifications",
        color: 0x3b82f6,
        description: "You have a new FullParty notification.",
        footerText: "🔔 FullParty • Custom Events",
        title: "Something Custom Happened",
      },
    );
  });
});

type ExpectedNotificationMessage = {
  actionLabel: string;
  actionUrl: string;
  color: number;
  description: string;
  footerText: string;
  thumbnailUrl?: string;
  title: string;
};

function expectNotificationMessage(
  message: MessageCreateOptions,
  expected: ExpectedNotificationMessage,
): void {
  const embed = message.embeds?.at(0) as APIEmbed | undefined;
  const presentation = createExpectedPresentation(
    stripExpectedActionLine(
      expected.description,
      expected.actionLabel,
      expected.actionUrl,
    ),
  );

  expect(embed).toBeDefined();
  expect(embed).toMatchObject({
    color: expected.color,
    description: presentation.description,
    footer: {
      text: expected.footerText,
    },
    url: expected.actionUrl,
  });
  if (presentation.fields.length > 0) {
    expect(embed?.fields).toEqual(presentation.fields);
  } else {
    expect(embed?.fields).toBeUndefined();
  }
  if (expected.thumbnailUrl) {
    expect(embed?.thumbnail).toEqual({
      url: expected.thumbnailUrl,
    });
  } else {
    expect(embed?.thumbnail).toBeUndefined();
  }
  expect(embed?.title).toContain(expected.title);
  expect(embed?.title).not.toBe(expected.title);
  expect(embed?.description).not.toContain(expected.actionUrl);
  expect(message.components).toEqual([
    {
      components: [
        {
          emoji: {
            name: "🔗",
          },
          label: expected.actionLabel,
          style: 5,
          type: 2,
          url: expected.actionUrl,
        },
      ],
      type: 1,
    },
  ]);
}

function stripExpectedActionLine(
  description: string,
  actionLabel: string,
  actionUrl: string,
): string {
  return description.replace(`\n\n${actionLabel}: ${actionUrl}`, "");
}

type ExpectedPresentation = {
  description: string;
  fields: NonNullable<APIEmbed["fields"]>;
};

function createExpectedPresentation(description: string): ExpectedPresentation {
  const paragraphs = description.split(/\n\n+/u);
  const summary = paragraphs.shift() ?? description;
  const detailLines = paragraphs.join("\n").split("\n").filter(isNonEmptyString);

  return {
    description: decorateExpectedSummary(summary),
    fields: createExpectedFields(detailLines),
  };
}

function decorateExpectedSummary(description: string): string {
  return description
    .split("\n")
    .map((line) => (line.startsWith("- ") ? `• ${line.slice(2)}` : line))
    .join("\n");
}

function createExpectedFields(lines: string[]): NonNullable<APIEmbed["fields"]> {
  const fields: NonNullable<APIEmbed["fields"]> = [];
  let currentMultilineField: NonNullable<APIEmbed["fields"]>[number] | undefined;

  for (const line of lines) {
    if (line.startsWith("- ")) {
      if (currentMultilineField) {
        const currentValue =
          currentMultilineField.value === expectedBlankFieldValue
            ? ""
            : `${currentMultilineField.value}\n`;
        currentMultilineField.value = `${currentValue}• ${line.slice(2)}`;
        currentMultilineField.inline = false;
      }
      continue;
    }

    const detail = parseExpectedDetailLine(line);

    if (!detail) {
      continue;
    }

    const field = {
      inline: detail.value.length <= 80 && !detail.value.includes("\n"),
      name: detail.name,
      value: detail.value || expectedBlankFieldValue,
    };

    fields.push(field);
    currentMultilineField = detail.value.length === 0 ? field : undefined;
  }

  return fields;
}

function parseExpectedDetailLine(
  line: string,
): { name: string; value: string } | undefined {
  const [label, ...rest] = line.split(":");

  if (!label || rest.length === 0) {
    return undefined;
  }

  const emoji = expectedDetailEmojiByLabel[label];
  const displayLabel = label === "Slot" ? "Party" : label;

  return {
    name: emoji ? `${emoji} ${displayLabel}` : displayLabel,
    value: rest.join(":").trim(),
  };
}

const expectedBlankFieldValue = "\u200b";

const expectedDetailEmojiByLabel: Record<string, string> = {
  Attendance: "📍",
  Character: "👤",
  "Character Class": "🧩",
  "Completed at": "✅",
  "Entry mode": "📝",
  "Applications waiting": "📥",
  Milestones: "🏁",
  Password: "🔐",
  Progress: "📈",
  "Posted at": "📣",
  "Raid Position": "📍",
  Reason: "📝",
  "Scheduled start": "🕒",
  Slot: "🎯",
  Status: "📌",
  World: "🌍",
};

function isNonEmptyString(value: string): boolean {
  return value.trim().length > 0;
}

function createNotificationDelivery(options: {
  actionUrl: string;
  category: string;
  params?: Record<string, unknown>;
  payload?: unknown;
  type: string;
}): NotificationDeliveryData {
  return {
    category: options.category,
    discord_user: {
      id: "123456789012345678",
    },
    notification: {
      action_url: options.actionUrl,
      category: options.category,
      params: options.params ?? {},
      payload: options.payload ?? null,
      type: options.type,
    },
    notification_delivery_id: 123,
    notification_event_id: 456,
    type: options.type,
    user: {
      id: 42,
      name: "Giki",
    },
  };
}
