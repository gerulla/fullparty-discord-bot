import { MessageFlags } from "discord.js";
import { describe, expect, it } from "vitest";
import { NotificationMessageService } from "../src/notifications/notificationMessageService.js";
import { notificationDeliveryDataSchema } from "../src/notifications/types.js";
import { dmDeliveryJobSchema } from "../src/dm/deliveryTypes.js";
import { messageComponents, messageText } from "./helpers/messages.js";

const service = new NotificationMessageService({
  fullpartyWebBaseUrl: "https://fullparty.gg",
});
const approved = [
  ["applications.cancelled", 10991030],
  ["applications.declined", 16731983],
  ["applications.submitted", 8453888],
  ["applications.updated", 2325220],
  ["applications.withdrawn", 10991030],
  ["applications.new_for_review", 33023],
  ["assignments.assigned", 6539064],
  ["assignments.designation_assigned", 15378965],
  ["assignments.designation_removed", 15378965],
  ["assignments.marked_missing", 15378965],
  ["assignments.missing_restored", 15378965],
  ["assignments.on_bench", 15378965],
  ["assignments.returned_to_queue", 15378965],
  ["assignments.roster_published_assigned", 6539064],
  ["assignments.roster_published_bench", 14453347],
  ["runs.cancelled", 9917105],
  ["runs.completed", 9917105],
  ["runs.party_finder_published", 9917105],
  ["runs.starting_now", 9917105],
  ["runs.starting_soon", 9917105],
] as const;

function payload(): Record<string, unknown> {
  return {
    run_title: "Our weekly raid",
    activity_title: "Original activity",
    group_name: "Our group",
    group_icon_url: "/images/group.webp",
    banner_image_url: "/images/banner.webp",
    starts_at: "2026-11-12T19:00:00Z",
    run_url: "/en/runs/456",
    application_url: "/applications/789",
    discord_url: "https://discord.gg/our-group",
    character_name: "Ari Vale",
    character_world: "Alpha",
    character_avatar_url: "/images/character.webp",
    applicant_name: "Applicant Ari",
    applicant_profile_url: "/users/ari",
    review_reason: "Our roster is full.",
    designation_label: "Run Leader",
    slot_label: "Party B",
    slot_group: "Party",
    roster: {
      selected_position: { label: { en: "Healer 1" } },
      fields: [
        {
          key: "character_class",
          label: { en: "Class" },
          display_value: "White Mage",
          meta: { icon_url: "/icons/whm.webp" },
        },
        {
          key: "phantom_job",
          label: "Phantom job",
          display_value: "Phantom Bard",
          icon_url: "/icons/bard.webp",
        },
      ],
    },
    completion: {
      completed_at: "2026-11-12T21:00:00Z",
      furthest_progress_label: "Final phase",
      furthest_progress_percent: 72,
      progress_entry_mode: "manual",
      progress_notes: "Reached enrage",
      progress_link_url: "/reports/42",
      milestones: [
        { milestone_label: { en: "First boss" }, best_progress_percent: 100, kills: 2 },
        { milestone_label: "Second boss", best_progress_percent: 0, kills: 0 },
      ],
    },
    party_finder: {
      character_name: "PF Host",
      character_world: "Beta",
      world: "Alpha",
      datacenter: "Light",
      region: "EU",
      password: "0042",
    },
  };
}

function delivery(
  type: string,
  data: unknown = payload(),
  params: Record<string, unknown> = {},
) {
  return notificationDeliveryDataSchema.parse({
    category: type.split(".")[0],
    type,
    discord_user: { id: "123456789012345678" },
    notification_delivery_id: 123,
    notification_event_id: 456,
    user: { id: 42, name: "Recipient Reviewer" },
    notification: {
      type,
      category: type.split(".")[0],
      params,
      payload: data,
      action_url: "/en/runs/456",
    },
  });
}

describe("approved notification V2 designs", () => {
  it.each(approved)("renders and persists %s with its saved accent", (type, color) => {
    const message = service.createDmMessage(delivery(type));
    expect(message.flags).toBe(MessageFlags.IsComponentsV2);
    expect(message.allowedMentions).toEqual({ parse: [], repliedUser: false });
    expect(message.embeds).toBeUndefined();
    expect(message.content).toBeUndefined();
    expect(messageComponents(message)[0]?.accent_color).toBe(color);
    expect(messageText(message)).toContain("Our weekly raid");
    expect(messageText(message)).toContain("Hosted By: Our group");
    expect(messageText(message)).toContain("<t:1794510000:F>");
    expect(JSON.stringify(message)).not.toMatch(
      /Cloud [Oo]f Darkness|Giki|Forked Tower Enjoyers|design_jhjm4jv6/,
    );
    expect(
      messageComponents(message)
        .filter((c) => c.type === 2)
        .every((c) => c.style === 5 && c.custom_id === undefined),
    ).toBe(true);
    expect(messageComponents(message).length).toBeLessThanOrEqual(40);
    expect(messageText(message).replaceAll("\n", "").length).toBeLessThanOrEqual(4000);
    expect(
      dmDeliveryJobSchema.parse({ discordUserId: "123", message, metadata: {} }).message,
    ).toEqual(message);
  });

  it.each(approved)(
    "handles older sparse %s payloads without fictional data or invalid sections",
    (type) => {
      const message = service.createDmMessage(delivery(type, null));
      expect(message.flags).toBe(32768);
      expect(messageText(message)).not.toMatch(
        /undefined|null|Giki|Cloud Of Darkness|1 Hour/,
      );
      expect(messageComponents(message).some((c) => c.type === 9 || c.type === 12)).toBe(
        false,
      );
      expect(
        dmDeliveryJobSchema.safeParse({ discordUserId: "123", message, metadata: {} })
          .success,
      ).toBe(true);
    },
  );

  it("keeps legacy rendering for every account/system type without a template", () => {
    for (const type of [
      "characters.added",
      "characters.primary_changed",
      "characters.unclaimed",
      "user.social_account.linked",
      "user.social_account.unlinked",
      "system.announcement",
      "system.maintenance.upcoming",
      "custom.changed",
    ]) {
      const message = service.createDmMessage(delivery(type));
      expect(message.flags).toBeUndefined();
      expect(message.embeds).toHaveLength(1);
      expect(messageComponents(message).every((c) => [1, 2].includes(c.type))).toBe(true);
    }
  });

  it("uses distinct application, run and Discord destinations and shows the host note", () => {
    const message = service.createDmMessage(delivery("applications.declined"));
    expect(messageText(message)).toContain("Note from the Host\nOur roster is full.");
    expect(messageComponents(message).filter((c) => c.type === 2)).toEqual([
      {
        type: 2,
        style: 5,
        label: "View Application",
        url: "https://fullparty.gg/applications/789",
      },
      { type: 2, style: 5, label: "View Run", url: "https://fullparty.gg/en/runs/456" },
      { type: 2, style: 5, label: "Discord Server", url: "https://discord.gg/our-group" },
    ]);
    const data = delivery("applications.submitted", {});
    data.notification.action_url = "/account/applications";
    expect(
      messageComponents(service.createDmMessage(data)).filter((c) => c.type === 2),
    ).toEqual([
      {
        type: 2,
        style: 5,
        label: "View Application",
        url: "https://fullparty.gg/account/applications",
      },
    ]);
  });

  it("uses the applicant's identity and explicit images, never the review recipient or first nested icon", () => {
    const message = service.createDmMessage(
      delivery("applications.new_for_review", payload(), { count: 3 }),
    );
    expect(messageText(message)).toContain("Ari Vale [Alpha]");
    expect(messageText(message)).toContain("Applicant Ari");
    expect(messageText(message)).toContain("Applications waiting:** 3");
    expect(messageText(message)).not.toContain("Recipient Reviewer");
    expect(
      messageComponents(message)
        .filter((c) => c.type === 11)
        .map((c) => c.media?.url),
    ).toEqual([
      "https://fullparty.gg/images/group.webp",
      "https://fullparty.gg/images/character.webp",
    ]);
    const missingApplicant = payload();
    delete missingApplicant.applicant_name;
    delete missingApplicant.applicant_profile_url;
    const fallback = service.createDmMessage(
      delivery("applications.new_for_review", missingApplicant),
    );
    expect(messageText(fallback)).not.toContain("Recipient Reviewer");
    expect(messageComponents(fallback).some((c) => c.label === "View User Profile")).toBe(
      false,
    );
  });

  it("keeps roster position/party separate from character and dynamic field images", () => {
    const message = service.createDmMessage(
      delivery("assignments.roster_published_assigned"),
    );
    expect(messageText(message)).toContain("Position**: Healer 1 - Party B");
    expect(messageText(message)).toContain("### Class\nWhite Mage");
    expect(messageText(message)).toContain("### Phantom job\nPhantom Bard");
    expect(
      messageComponents(message)
        .filter((c) => c.type === 11)
        .map((c) => c.media?.url),
    ).toEqual([
      "https://fullparty.gg/images/group.webp",
      "https://fullparty.gg/images/character.webp",
      "https://fullparty.gg/icons/whm.webp",
      "https://fullparty.gg/icons/bard.webp",
    ]);
    const bench = service.createDmMessage(delivery("assignments.roster_published_bench"));
    expect(messageText(bench)).toContain("Position**: Bench");
    expect(messageText(bench)).not.toContain("Party B");
    expect(messageComponents(bench).some((c) => c.label === "View Roster")).toBe(true);
  });

  it.each(["assignments.assigned", "assignments.roster_published_assigned"])(
    "shows the filled party separately from the slot in %s",
    (type) => {
      const data = delivery(
        type,
        {
          character_name: "Ari Vale",
          slot_label: "Fill in 1 (Party B)",
          slot_group: "Fill-ins",
          roster: {
            group_key: "fill-ins",
            group_label: "Fill-ins",
            slot_label: "Fill in 1 (Party B)",
            is_fill_in: true,
            filled_group_key: "party-b",
            filled_group_label: "Party B",
          },
        },
        { slot: "Fill in 1 (Party B)", slot_group: "Fill-ins" },
      );
      const rendered = messageText(service.createDmMessage(data));
      expect(rendered).toContain("Position**: Fill in 1 (Party B)");
      expect(rendered).toContain("-# Filling in for Party B");
      expect(rendered).not.toContain("Filling in for Fill-ins");

      data.notification.type = "assignments.roster_published_bench";
      data.type = "assignments.roster_published_bench";
      const bench = messageText(service.createDmMessage(data));
      expect(bench).toContain("Position**: Bench");
      expect(bench).not.toContain("Filling in for");
    },
  );

  it.each([
    { is_fill_in: false, filled_group_label: "Party B" },
    { is_fill_in: true },
    { is_fill_in: true, filled_group_label: null },
    { is_fill_in: true, filled_group_label: "  " },
  ])("omits the filled-party line without a current fill-in target: %j", (roster) => {
    const message = service.createDmMessage(
      delivery("assignments.assigned", { slot_label: "Fill in 1", roster }),
    );
    expect(messageText(message)).toContain("Position**: Fill in 1");
    expect(messageText(message)).not.toContain("Filling in for");
  });

  it("escapes filled-party display labels", () => {
    const message = service.createDmMessage(
      delivery("assignments.assigned", {
        roster: { is_fill_in: true, filled_group_label: "Party **B**" },
      }),
    );
    expect(messageText(message)).toContain("Filling in for Party \\*\\*B\\*\\*");
  });

  it.each([
    ["assignments.designation_assigned", "Run Leader assigned"],
    ["assignments.designation_removed", "Run Leader removed"],
    ["assignments.marked_missing", "Marked missing"],
    ["assignments.missing_restored", "Missing status cleared"],
    ["assignments.on_bench", "Moved to bench"],
    ["assignments.returned_to_queue", "Returned to queue"],
  ])("uses the compact status layout for %s", (type, title) => {
    const message = service.createDmMessage(delivery(type));
    expect(messageText(message)).toContain("## " + title);
    expect(messageText(message)).not.toContain("### Character");
    expect(messageComponents(message).filter((c) => c.type === 11)).toHaveLength(1);
  });

  it.each([
    ["trapper", "Trapper"],
    ["darter", "Darter"],
    ["duelist", "Duelist"],
    ["raid_leader", "Raid Leader"],
    ["future_designation", "Future Designation"],
  ])("uses the designation key as a display fallback for %s", (key, label) => {
    const message = service.createDmMessage(
      delivery("assignments.designation_assigned", {
        designation_key: key,
        designation_assigned: true,
      }),
    );
    expect(messageText(message)).toContain(`## ${label} assigned`);
    expect(messageComponents(message).find((c) => c.label === "View run")?.url).toBe(
      "https://fullparty.gg/en/runs/456",
    );
  });

  it("uses the supplied designation label without interpreting it as a key or status", () => {
    const message = service.createDmMessage(
      delivery(
        "assignments.designation_removed",
        {
          designation_key: "trapper",
          designation_label: "Trappeur",
          designation_assigned: false,
        },
        { designation: "Raid Leader" },
      ),
    );
    expect(messageText(message)).toContain("## Trappeur removed");
    expect(messageText(message)).not.toContain("Raid Leader");
    expect(messageText(message)).not.toContain("Trapper");
  });

  it("omits the designation run button when action_url is absent", () => {
    const data = delivery("assignments.designation_assigned");
    delete data.notification.action_url;
    const message = service.createDmMessage(data);
    expect(messageComponents(message).some((c) => c.label === "View run")).toBe(false);
    expect(messageComponents(message).some((c) => c.label === "View Assignment")).toBe(
      false,
    );
  });

  it("shows data.cancellation_reason in the same host-note container as application declines", () => {
    const reason = "Not enough participants.";
    const data = notificationDeliveryDataSchema.parse({
      ...delivery(
        "runs.cancelled",
        { ...payload(), cancellation_reason: "Payload fallback" },
        { reason: "Parameter fallback" },
      ),
      cancellation_reason: reason,
    });
    const message = service.createDmMessage(data);
    const application = service.createDmMessage(
      delivery("applications.declined", payload(), { reason }),
    );
    const note = messageComponents(application).find(
      (component) =>
        component.type === 17 &&
        component.components?.some((child) =>
          child.content?.startsWith("## Note from the Host"),
        ),
    );
    expect(note).toBeDefined();
    const roots = (message.components ?? []) as unknown[];
    expect(roots[2]).toEqual(note);
    expect(messageText(message)).toContain(`Note from the Host\n${reason}`);
    expect(messageText(message)).not.toContain("fallback");
    expect(
      messageComponents(message)
        .filter((c) => c.type === 2)
        .map((c) => c.label),
    ).toEqual(["View Run", "Discord Server"]);
    expect(message.flags).toBe(MessageFlags.IsComponentsV2);
    expect(
      dmDeliveryJobSchema.parse({
        discordUserId: data.discord_user.id,
        message,
        metadata: {},
      }).message,
    ).toEqual(message);
  });

  it.each([{ cancellation_reason: "Payload reason" }, {}])(
    "uses the available cancellation reason fallback: %j",
    (details) => {
      const message = service.createDmMessage(
        delivery("runs.cancelled", details, { reason: "Parameter reason" }),
      );
      expect(messageText(message)).toContain(
        `Note from the Host\n${details.cancellation_reason ?? "Parameter reason"}`,
      );
    },
  );

  it.each([undefined, null, "", "  \n ", 123, {}])(
    "omits the cancellation note for unusable reason %j",
    (reason) => {
      const data = notificationDeliveryDataSchema.parse({
        ...delivery("runs.cancelled"),
        cancellation_reason: reason,
      });
      const message = service.createDmMessage(data);
      expect(messageText(message)).toContain("Run Cancelled");
      expect(messageText(message)).not.toContain("Note from the Host");
    },
  );

  it("escapes and bounds cancellation notes without enabling mentions", () => {
    const data = notificationDeliveryDataSchema.parse({
      ...delivery("runs.cancelled"),
      cancellation_reason: `  **Roster** incomplete.\n@everyone ${"*".repeat(6000)}  `,
    });
    const message = service.createDmMessage(data);
    expect(messageText(message)).toContain(
      "Note from the Host\n\\*\\*Roster\\*\\* incomplete.\n@everyone",
    );
    expect(messageText(message).length).toBeLessThanOrEqual(4000);
    expect(message.allowedMentions).toEqual({ parse: [], repliedUser: false });
    expect(messageComponents(message).length).toBeLessThanOrEqual(40);
    data.notification.type = "runs.starting_now";
    data.type = "runs.starting_now";
    expect(messageText(service.createDmMessage(data))).not.toContain(
      "Note from the Host",
    );
  });

  it("uses real progress, zero values and completion time", () => {
    const message = service.createDmMessage(delivery("runs.completed"));
    expect(messageText(message)).toContain("Final phase (72%)");
    expect(messageText(message)).toContain("First boss: 100% best, 2 kills");
    expect(messageText(message)).toContain("Second boss: 0% best, 0 kills");
    expect(messageText(message)).toContain("Run Complete - <t:1794517200:F>");
    expect(messageText(message)).toContain("Reached enrage");
  });

  it("renders PF location, character world, password and relative reminder time", () => {
    const pf = service.createDmMessage(delivery("runs.party_finder_published"));
    expect(messageText(pf)).toContain("Alpha - Light - EU");
    expect(messageText(pf)).toContain("PF Host @ Beta");
    expect(messageText(pf)).toContain("`0042`");
    const reminder = service.createDmMessage(delivery("runs.starting_soon"));
    expect(messageText(reminder)).toContain("<t:1794510000:R>");
    expect(messageText(reminder)).not.toContain("1 Hour");
  });

  it("bounds large dynamic fields and omits invalid or oversized button URLs", () => {
    const large = payload();
    large.run_title = "a".repeat(5000);
    large.group_name = "b".repeat(5000);
    large.roster = {
      fields: Array.from({ length: 50 }, (_, i) => ({
        key: "field" + String(i),
        label: "Field " + String(i),
        display_value: "c".repeat(5000),
        icon_url: "/icons/field.webp",
      })),
    };
    large.group_icon_url = "javascript:alert(1)";
    large.discord_url = "https://discord.gg/" + "d".repeat(600);
    const message = service.createDmMessage(delivery("assignments.assigned", large));
    expect(messageComponents(message).length).toBeLessThanOrEqual(40);
    expect(messageText(message).length).toBeLessThanOrEqual(4000);
    expect(messageComponents(message).some((c) => c.label === "Discord Server")).toBe(
      false,
    );
    expect(JSON.stringify(message)).not.toContain("javascript:");
    expect(
      dmDeliveryJobSchema.safeParse({ discordUserId: "123", message, metadata: {} })
        .success,
    ).toBe(true);
  });
});
