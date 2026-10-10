import { describe, expect, it } from "vitest";
import {
  createAccountLinkInstructions,
  createAccountLinkRequiredMessage,
  createDiscordLoginWelcomeMessage,
  createGuildConnectedMessage,
  createGuildLinkInstructions,
  createGuildLinkRequiredMessage,
  createUserConnectedMessage,
  createUserDisconnectedMessage,
  type LinkMessageOptions,
  type LinkV2Message,
} from "../src/discord/linkMessages.js";
import { dmDeliveryJobSchema } from "../src/dm/deliveryTypes.js";
import { messageComponents, messageText } from "./helpers/messages.js";

const options: LinkMessageOptions = {
  fullpartyWebBaseUrl: "https://staging.fullparty.test/en/",
  installUrl: "https://staging.fullparty.test/install",
  accountSettingsUrl: "/en/settings/notifications",
  botSettingsUrl: "/groups/example/configuration/discord",
  feedbackUrl: "/feedback",
  disconnectGuideImageUrl: "/images/discord-disconnect.png",
};

const builders: [string, (options: LinkMessageOptions) => LinkV2Message][] = [
  ["Discord login", createDiscordLoginWelcomeMessage],
  ["account link instructions", createAccountLinkInstructions],
  ["connected account", createUserConnectedMessage],
  ["disconnected account", createUserDisconnectedMessage],
  ["guild link instructions", createGuildLinkInstructions],
  ["connected guild", createGuildConnectedMessage],
  ["account link required", createAccountLinkRequiredMessage],
  ["guild link required", createGuildLinkRequiredMessage],
];

describe("V2 link messages", () => {
  it.each(builders)(
    "preserves the entire %s message through durable DM serialization",
    (_name, build) => {
      for (const input of [
        options,
        { fullpartyWebBaseUrl: options.fullpartyWebBaseUrl },
      ]) {
        const message = build(input);
        const job = {
          discordUserId: "234567890123456789",
          message,
          metadata: { eventType: "test.link_message" },
        };

        expect(dmDeliveryJobSchema.parse(JSON.parse(JSON.stringify(job)))).toEqual(job);
        expect(message).toMatchObject({
          flags: 32768,
          allowedMentions: { parse: [], repliedUser: false },
        });
        expect(message).not.toHaveProperty("content");
        expect(message).not.toHaveProperty("embeds");
        expect(messageComponents(message).length).toBeLessThan(40);
        expect(messageText(message).length).toBeLessThan(4000);
      }
    },
  );

  it.each([
    ["missing", undefined],
    ["null", null],
    ["blank", "   "],
    ["non-string", { url: "https://fullparty.gg" }],
    ["script", "javascript:alert(1)"],
    ["file", "file:///local/file"],
    ["credentials", "https://user:password@fullparty.gg/settings"],
    ["malformed", "https://["],
    ["oversized", urlWithLength(2049)],
  ])("handles %s optional URLs without broken controls", (_name, value) => {
    const input = {
      fullpartyWebBaseUrl: options.fullpartyWebBaseUrl,
      installUrl: value,
      accountSettingsUrl: value,
      botSettingsUrl: value,
      feedbackUrl: value,
      disconnectGuideImageUrl: value,
    };
    const account = createAccountLinkInstructions(input);
    expect(buttonUrls(account)).toEqual([
      "https://staging.fullparty.test/auth/discord-app/user/redirect",
      "https://staging.fullparty.test/settings",
    ]);

    const disconnected = createUserDisconnectedMessage(input);
    expect(buttonUrls(disconnected)).toEqual([]);
    expect(messageComponents(disconnected).some(({ type }) => type === 12)).toBe(false);
    expect(messageText(disconnected)).toContain("Authorized Apps");
    expect(buttonUrls(createGuildConnectedMessage(input))).toEqual([]);
  });

  it("uses the configured website origin for static install and settings paths", () => {
    const message = createDiscordLoginWelcomeMessage({
      fullpartyWebBaseUrl: "http://fullparty.test:8080/en/",
    });

    expect(buttonUrls(message)).toEqual([
      "http://fullparty.test:8080/auth/discord-app/user/redirect",
      "http://fullparty.test:8080/settings",
    ]);
  });

  it("honors valid settings, feedback and guide URLs relative to the configured website", () => {
    expect(buttonUrls(createUserConnectedMessage(options))).toEqual([
      "https://staging.fullparty.test/en/settings/notifications",
    ]);
    expect(buttonUrls(createGuildConnectedMessage(options))).toEqual([
      "https://staging.fullparty.test/groups/example/configuration/discord",
    ]);
    const disconnected = createUserDisconnectedMessage(options);
    expect(buttonUrls(disconnected)).toEqual(["https://staging.fullparty.test/feedback"]);
    expect(disconnected.components).toContainEqual({
      type: 12,
      items: [
        {
          media: { url: "https://staging.fullparty.test/images/discord-disconnect.png" },
        },
      ],
    });
  });

  it("applies separate URL length limits to buttons and gallery media", () => {
    const accepted = createUserDisconnectedMessage({
      ...options,
      feedbackUrl: urlWithLength(512),
      disconnectGuideImageUrl: urlWithLength(2048),
    });
    expect(buttonUrls(accepted)).toEqual([urlWithLength(512)]);
    expect(accepted.components).toContainEqual({
      type: 12,
      items: [{ media: { url: urlWithLength(2048) } }],
    });

    const rejected = createUserDisconnectedMessage({
      ...options,
      feedbackUrl: urlWithLength(513),
      disconnectGuideImageUrl: urlWithLength(2049),
    });
    expect(buttonUrls(rejected)).toEqual([]);
    expect(messageComponents(rejected).some(({ type }) => type === 12)).toBe(false);
  });

  it("builds Bot Settings from the group slug and configured website", () => {
    expect(
      buttonUrls(
        createGuildConnectedMessage({
          fullpartyWebBaseUrl: "http://fullparty.test:8080/en/",
          groupSlug: "  example-raiders  ",
        }),
      ),
    ).toEqual([
      "http://fullparty.test:8080/groups/example-raiders/dashboard/discord-integration",
    ]);
    expect(
      buttonUrls(
        createGuildConnectedMessage({
          fullpartyWebBaseUrl: "https://fullparty.gg",
          groupSlug: "group/name?#",
        }),
      ),
    ).toEqual([
      "https://fullparty.gg/groups/group%2Fname%3F%23/dashboard/discord-integration",
    ]);
  });

  it("prefers an explicit Bot Settings URL and falls back to the slug if unusable", () => {
    const input = { ...options, groupSlug: "example-raiders" };
    expect(buttonUrls(createGuildConnectedMessage(input))).toEqual([
      "https://staging.fullparty.test/groups/example/configuration/discord",
    ]);
    expect(
      buttonUrls(
        createGuildConnectedMessage({
          ...input,
          botSettingsUrl: "javascript:alert(1)",
        }),
      ),
    ).toEqual([
      "https://staging.fullparty.test/groups/example-raiders/dashboard/discord-integration",
    ]);
  });

  it.each([null, undefined, 42, " ", ".", "..", "\uD800", "x".repeat(600)])(
    "omits Bot Settings when neither a URL nor a usable slug is available: %j",
    (groupSlug) => {
      expect(
        buttonUrls(
          createGuildConnectedMessage({
            fullpartyWebBaseUrl: "https://fullparty.gg",
            groupSlug,
          }),
        ),
      ).toEqual([]);
    },
  );

  it("bounds custom welcome text while retaining setup help and disabling mentions", () => {
    const message = createUserConnectedMessage({
      ...options,
      welcomeMessage: `  @everyone ${"x".repeat(5000)}  `,
    });
    const first = messageComponents(message)[0];

    expect(first?.content).toHaveLength(2000);
    expect(first?.content).toMatch(/^@everyone /u);
    expect(messageText(message)).toContain("`/help`");
    expect(messageText(message).length).toBeLessThan(4000);
    expect(message.allowedMentions).toEqual({ parse: [], repliedUser: false });
    expect(
      dmDeliveryJobSchema.parse({ discordUserId: "test", message, metadata: {} }).message,
    ).toEqual(message);
  });

  it("keeps the default welcome when a direct caller supplies blank override text", () => {
    expect(
      messageText(createUserConnectedMessage({ ...options, welcomeMessage: "   " })),
    ).toContain("Thank You for Connecting Your Discord Account");
  });
});

function buttonUrls(message: LinkV2Message): (string | undefined)[] {
  return messageComponents(message)
    .filter(({ type }) => type === 2)
    .map(({ url }) => url);
}

function urlWithLength(length: number): string {
  const prefix = "https://fullparty.gg/";
  return `${prefix}${"x".repeat(length - prefix.length)}`;
}
