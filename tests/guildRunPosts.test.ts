import { ButtonStyle, ComponentType, ContainerBuilder, MessageFlags } from "discord.js";
import { describe, expect, it } from "vitest";
import { resolveV2MessageIcons } from "../src/discord/v2.js";
import { createGuildUpcomingRunsPostMessage } from "../src/fullparty/discordGuildRunPosts.js";
import { messageComponents, messageText } from "./helpers/messages.js";

const baseUrl = "https://fullparty.gg";
const hostId = "800000000000000001";
const run = {
  title: "Cloud Of Darkness - Run2 Electric Boogaloo",
  starts_at: "2026-10-22T17:00:00Z",
  counts: { assigned_slots: 3, total_slots: 48, total_applicants: 1 },
  host: {
    discord_user_id: hostId,
    avatar_url: "https://example.com/host.png",
    character: { name: "Giki Chomusuke", avatar_url: "/characters/giki.jpg" },
  },
  urls: {
    overview: "/groups/raiders/activities/123",
    application: "/groups/raiders/activities/123/application",
  },
};
const response = {
  data: [run],
  meta: { group: { name: "Example Raiders", slug: "raiders" } },
};

describe("upcoming run schedule formats", () => {
  it("retains the current schedule verbatim as the default Plain format", () => {
    const message = createGuildUpcomingRunsPostMessage(response, baseUrl);
    expect(message).toEqual({
      allowedMentions: { parse: [] },
      content: [
        "Here are the upcoming FullParty runs for **Example Raiders**:",
        "",
        "**Cloud Of Darkness - Run2 Electric Boogaloo**",
        "3/48 Participants - 1 Applications - <t:1792688400:F> (<t:1792688400:R>)",
        "Hosted by <@800000000000000001> - [Apply Here](<https://fullparty.gg/groups/raiders/activities/123/application>)",
        "",
        "-# For the full schedule of **Example Raiders** [Click Here](<https://fullparty.gg/en/groups/raiders/dashboard/activities>)",
      ].join("\n"),
    });
    expect(createGuildUpcomingRunsPostMessage(response, baseUrl, "plain")).toEqual(
      message,
    );
    expect(createGuildUpcomingRunsPostMessage(response, baseUrl, "interactive")).toEqual(
      message,
    );
  });

  it("builds the Expanded V2 design with timestamps, counts, host and avatar", () => {
    const message = createGuildUpcomingRunsPostMessage(response, baseUrl, "expanded");
    expect(message.flags).toBe(MessageFlags.IsComponentsV2);
    expect(message.allowedMentions).toEqual({ parse: [], repliedUser: false });
    expect(message.content).toBeUndefined();
    expect(message).not.toHaveProperty("embeds");
    expect(message.components?.[0]).toEqual({
      type: ComponentType.Container,
      accent_color: 9917105,
      components: [
        {
          type: ComponentType.TextDisplay,
          content: "## Cloud Of Darkness - Run2 Electric Boogaloo",
        },
        {
          type: ComponentType.Section,
          components: [
            {
              type: ComponentType.TextDisplay,
              content: [
                ":fpclock: **Scheduled Start:** <t:1792688400:F> (<t:1792688400:R>)",
                ":fpnametag: 3/48 Participants - 1 Application(s)",
                ":fpatsymbol: Hosted By <@800000000000000001>",
              ].join("\n"),
            },
          ],
          accessory: {
            type: ComponentType.Thumbnail,
            media: { url: "https://example.com/host.png" },
            description: "Host profile picture",
          },
        },
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.Button,
              style: ButtonStyle.Link,
              label: "View Run",
              url: "https://fullparty.gg/groups/raiders/activities/123",
            },
            {
              type: ComponentType.Button,
              style: ButtonStyle.Link,
              label: "Apply Now",
              url: "https://fullparty.gg/groups/raiders/activities/123/application",
            },
          ],
        },
      ],
    });
    const container = message.components?.find(
      (component) => component.type === ComponentType.Container,
    );
    expect(() => new ContainerBuilder(container).toJSON()).not.toThrow();
  });

  it("retains progress targets and accepts character avatars as a fallback", () => {
    const message = createGuildUpcomingRunsPostMessage(
      {
        data: [
          {
            ...run,
            target_prog_point: { label: { en: "Titan Cleanup" } },
            host: { ...run.host, avatar_url: undefined },
          },
        ],
      },
      baseUrl,
      "expanded",
    );
    expect(messageText(message)).toContain("Electric Boogaloo - Titan Cleanup");
    expect(
      messageComponents(message).find((component) => component.type === 11)?.media,
    ).toEqual({ url: "https://fullparty.gg/characters/giki.jpg" });
  });

  it("has a valid text-only card when optional data or images are missing", () => {
    const message = createGuildUpcomingRunsPostMessage(
      { data: [{ title: "Next run", host: { name: "Host Person" } }] },
      baseUrl,
      "expanded",
    );
    expect(messageText(message)).toContain("**Scheduled Start:** Time TBD");
    expect(messageText(message)).toContain("?/? Participants - ? Application(s)");
    expect(messageText(message)).toContain("Hosted By Host Person");
    expect(messageText(message)).not.toContain("Apply on FullParty");
    expect(messageComponents(message).some((component) => component.type === 1)).toBe(
      false,
    );
    expect(messageComponents(message).some((component) => component.type === 9)).toBe(
      false,
    );
    const container = message.components?.find(
      (component) => component.type === ComponentType.Container,
    );
    expect(() => new ContainerBuilder(container).toJSON()).not.toThrow();
  });

  it("omits unsafe links and images and escapes user-controlled labels", () => {
    const message = createGuildUpcomingRunsPostMessage(
      {
        data: [
          {
            ...run,
            title: "Injected\n## **title** @everyone",
            urls: {
              overview: "https://user:password@example.com/run",
              application: "javascript:alert(1)",
            },
            host: {
              name: "[Host](https://untrusted.example)",
              avatar_url: "https://user:password@example.com/avatar.png",
              character: { avatar_url: "data:image/png;base64,abc" },
            },
          },
        ],
        meta: { group: { name: "**Group**", urls: { schedule: "file:///etc/passwd" } } },
      },
      baseUrl,
      "expanded",
    );
    const text = messageText(message);
    expect(text).toContain("\\*\\*title\\*\\* @\u200beveryone");
    expect(text).not.toContain("Injected\n");
    expect(text).not.toContain("[Apply Now]");
    expect(text).not.toContain("[Click Here]");
    expect(text).toContain("Hosted By \\[Host](https://untrusted.example)");
    expect(messageComponents(message).some((component) => component.type === 11)).toBe(
      false,
    );
    expect(messageComponents(message).some((component) => component.type === 2)).toBe(
      false,
    );
  });

  it.each([
    {
      description: "has only an application URL",
      urls: { application: "/runs/123/apply" },
      expected: [{ label: "Apply Now", url: "https://fullparty.gg/runs/123/apply" }],
    },
    {
      description: "has only a run URL",
      urls: { run: "/runs/123" },
      expected: [{ label: "View Run", url: "https://fullparty.gg/runs/123" }],
    },
    {
      description: "has an unsafe run URL",
      urls: { overview: "javascript:alert(1)", application: "/runs/123/apply" },
      expected: [{ label: "Apply Now", url: "https://fullparty.gg/runs/123/apply" }],
    },
    {
      description: "has an unsafe application URL",
      urls: { overview: "/runs/123", application: "file:///etc/passwd" },
      expected: [{ label: "View Run", url: "https://fullparty.gg/runs/123" }],
    },
  ])(
    "keeps valid buttons independently when the run $description",
    ({ urls, expected }) => {
      const message = createGuildUpcomingRunsPostMessage(
        { data: [{ ...run, urls }] },
        baseUrl,
        "expanded",
      );
      expect(
        messageComponents(message).filter((component) => component.type === 2),
      ).toEqual(
        expected.map((button) => ({
          type: ComponentType.Button,
          style: ButtonStyle.Link,
          ...button,
        })),
      );
    },
  );

  it("preserves the existing Apply URL fallbacks without using action_url as View Run", () => {
    const message = createGuildUpcomingRunsPostMessage(
      { data: [{ title: "Run", action_url: "/runs/123/apply" }] },
      baseUrl,
      "expanded",
    );
    expect(
      messageComponents(message).filter((component) => component.type === 2),
    ).toEqual([
      {
        type: ComponentType.Button,
        style: ButtonStyle.Link,
        label: "Apply Now",
        url: "https://fullparty.gg/runs/123/apply",
      },
    ]);
    const overviewOnly = createGuildUpcomingRunsPostMessage(
      { data: [{ title: "Run", urls: { overview: "/runs/123" } }] },
      baseUrl,
      "expanded",
    );
    expect(
      messageComponents(overviewOnly)
        .filter((component) => component.type === 2)
        .map(({ label, url }) => ({ label, url })),
    ).toEqual([
      { label: "View Run", url: "https://fullparty.gg/runs/123" },
      { label: "Apply Now", url: "https://fullparty.gg/runs/123" },
    ]);
  });

  it("never treats an arbitrary Discord user ID as mention markup", () => {
    const message = createGuildUpcomingRunsPostMessage(
      { data: [{ ...run, host: { discord_user_id: "1> @everyone <@2" } }] },
      baseUrl,
      "expanded",
    );
    expect(messageText(message)).toContain("Hosted By Host unavailable");
    expect(messageText(message)).not.toContain("@everyone");
  });

  it("keeps dense schedules within component limits and links to the full schedule", () => {
    const message = createGuildUpcomingRunsPostMessage(
      { ...response, data: Array.from({ length: 25 }, () => run) },
      baseUrl,
      "expanded",
    );
    const components = messageComponents(message);
    const visible = components.filter((component) => component.type === 17).length;
    expect(visible).toBeGreaterThan(0);
    expect(components.length).toBeLessThanOrEqual(40);
    expect(components.filter((component) => component.type === 2)).toHaveLength(
      visible * 2,
    );
    expect(messageText(message)).toContain(
      `...and ${String(25 - visible)} more upcoming runs.`,
    );
    expect(messageText(message)).toContain("For the full schedule");
  });

  it("preserves the overflow count and footer even after custom emoji expansion", () => {
    const message = createGuildUpcomingRunsPostMessage(
      {
        ...response,
        data: Array.from({ length: 25 }, () => ({
          ...run,
          title: "Very long :fpclock: run title ".repeat(50),
          host: { ...run.host, discord_user_id: undefined, name: "Host".repeat(100) },
          urls: { application: `https://fullparty.gg/${"a".repeat(450)}` },
        })),
      },
      baseUrl,
      "expanded",
    );
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
    const text = messageText(resolved);
    expect(text).toContain("<a:fpclock:12345678901234567890>");
    expect(text).toContain("more upcoming runs.");
    expect(text).toContain("For the full schedule of **Example Raiders**");
    expect(text).toContain("/dashboard/activities>)");
    expect(
      messageComponents(resolved).reduce(
        (length, component) => length + (component.content?.length ?? 0),
        0,
      ),
    ).toBeLessThanOrEqual(4000);
  });

  it("renders an empty schedule in V2 with a useful full-schedule link", () => {
    const message = createGuildUpcomingRunsPostMessage(
      { ...response, data: [] },
      baseUrl,
      "expanded",
    );
    expect(message.flags).toBe(MessageFlags.IsComponentsV2);
    expect(messageText(message)).toContain("No upcoming FullParty runs were found");
    expect(messageText(message)).toContain("Example Raiders");
    expect(messageText(message)).toContain("/dashboard/activities");
    expect(message.components).toHaveLength(1);
  });
});
