import { describe, expect, it } from "vitest";
import type { APIEmbed, MessageCreateOptions } from "discord.js";

import {
  getSupportedNotificationTypes,
  NotificationMessageService,
} from "../src/notifications/notificationMessageService.js";
import type { NotificationDeliveryData } from "../src/notifications/types.js";

describe("NotificationMessageService", () => {
  it("has copy for current Discord-delivered notification types", () => {
    expect(getSupportedNotificationTypes()).toEqual(
      expect.arrayContaining([
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
        "system.maintenance.upcoming",
        "system.announcement",
      ]),
    );
  });

  it("renders known notification types as Discord embeds", () => {
    const service = new NotificationMessageService({
      fullpartyWebBaseUrl: "https://fullparty.gg",
    });

    expectNotificationMessage(
      service.createDmMessage(
        createNotificationDelivery({
          actionUrl: "/groups/example/activities/99",
          category: "assignments",
          type: "assignments.assigned",
        }),
      ),
      {
        actionLabel: "View assignment",
        actionUrl: "https://fullparty.gg/groups/example/activities/99",
        color: 0x22c55e,
        description: "You were assigned to a roster slot.",
        footerText: "🎯 FullParty • Assignments",
        title: "Roster assignment updated",
      },
    );
  });

  it.each([
    {
      actionLabel: "View applications",
      actionUrl: "http://fullparty.test/en/account/applications",
      color: 0x22c55e,
      description:
        "Your application was submitted for AAC Cruiserweight M1 (Savage) in asd.\n\nScheduled start: <t:1780351200:F> (<t:1780351200:R>)\nCharacter: Giki Chomusuke\nStatus: Pending\n\nView applications: http://fullparty.test/en/account/applications",
      params: {
        activity: "AAC Cruiserweight M1 (Savage)",
        character: "Giki Chomusuke",
        group: "asd",
        reason: null,
      },
      payload: {
        activity_id: 6933,
        activity_title: "AAC Cruiserweight M1 (Savage)",
        application_id: 221791,
        character_name: "Giki Chomusuke",
        group_id: 21,
        group_slug: "asdd",
        review_reason: null,
        starts_at: "2026-06-01T22:00:00+00:00",
        status: "pending",
      },
      title: "Application submitted",
      type: "applications.submitted",
    },
    {
      actionLabel: "Review application",
      actionUrl: "http://fullparty.test/dashboard/groups/elemental-current/runs/99",
      color: 0x3b82f6,
      description:
        "A new application needs review for AAC Cruiserweight M4 (Savage) in Elemental Current.\n\nCharacter: Ciela Dawn\nStatus: Pending\nApplications waiting: 1\n\nReview application: http://fullparty.test/dashboard/groups/elemental-current/runs/99",
      params: {
        activity: "AAC Cruiserweight M4 (Savage)",
        character: "Ciela Dawn",
        count: 1,
        group: "Elemental Current",
        reason: null,
      },
      payload: {
        activity_id: 99,
        activity_title: "AAC Cruiserweight M4 (Savage)",
        application_id: 501,
        character_name: "Ciela Dawn",
        group_id: 12,
        group_slug: "elemental-current",
        review_reason: null,
        status: "pending",
      },
      title: "Application needs review",
      type: "applications.new_for_review",
    },
    {
      actionLabel: "Review application",
      actionUrl: "http://fullparty.test/dashboard/groups/elemental-current/runs/99",
      color: 0x3b82f6,
      description:
        "An application was updated for AAC Cruiserweight M4 (Savage) in Elemental Current.\n\nCharacter: Nova Vale\nStatus: Pending\n\nReview application: http://fullparty.test/dashboard/groups/elemental-current/runs/99",
      params: {
        activity: "AAC Cruiserweight M4 (Savage)",
        character: "Nova Vale",
        group: "Elemental Current",
        reason: null,
      },
      payload: {
        activity_id: 99,
        activity_title: "AAC Cruiserweight M4 (Savage)",
        application_id: 502,
        character_name: "Nova Vale",
        group_id: 12,
        group_slug: "elemental-current",
        review_reason: null,
        status: "pending",
      },
      title: "Application updated",
      type: "applications.updated",
    },
    {
      actionLabel: "View run",
      actionUrl: "http://fullparty.test/dashboard/groups/elemental-current/runs/99",
      color: 0x6b7280,
      description:
        "An application was withdrawn for AAC Cruiserweight M4 (Savage) in Elemental Current.\n\nCharacter: Iris Sol\nStatus: Withdrawn\n\nView run: http://fullparty.test/dashboard/groups/elemental-current/runs/99",
      params: {
        activity: "AAC Cruiserweight M4 (Savage)",
        character: "Iris Sol",
        group: "Elemental Current",
        reason: null,
      },
      payload: {
        activity_id: 99,
        activity_title: "AAC Cruiserweight M4 (Savage)",
        application_id: 503,
        character_name: "Iris Sol",
        group_id: 12,
        group_slug: "elemental-current",
        review_reason: null,
        status: "withdrawn",
      },
      title: "Application withdrawn",
      type: "applications.withdrawn",
    },
    {
      actionLabel: "View applications",
      actionUrl: "http://fullparty.test/account/applications",
      color: 0xd83c3e,
      description:
        "Your application was declined for AAC Cruiserweight M4 (Savage) in Elemental Current.\n\nCharacter: Luna Crest\nStatus: Declined\nReason: Roster is already full.\n\nView applications: http://fullparty.test/account/applications",
      params: {
        activity: "AAC Cruiserweight M4 (Savage)",
        character: "Luna Crest",
        group: "Elemental Current",
        reason: "Roster is already full.",
      },
      payload: {
        activity_id: 99,
        activity_title: "AAC Cruiserweight M4 (Savage)",
        application_id: 504,
        character_name: "Luna Crest",
        group_id: 12,
        group_slug: "elemental-current",
        review_reason: "Roster is already full.",
        status: "declined",
      },
      title: "Application declined",
      type: "applications.declined",
    },
    {
      actionLabel: "View applications",
      actionUrl: "http://fullparty.test/account/applications",
      color: 0x6b7280,
      description:
        "Your application was cancelled for AAC Cruiserweight M4 (Savage) in Elemental Current.\n\nCharacter: Rin Vale\nStatus: Cancelled\n\nView applications: http://fullparty.test/account/applications",
      params: {
        activity: "AAC Cruiserweight M4 (Savage)",
        character: "Rin Vale",
        group: "Elemental Current",
        reason: null,
      },
      payload: {
        activity_id: 99,
        activity_title: "AAC Cruiserweight M4 (Savage)",
        application_id: 505,
        character_name: "Rin Vale",
        group_id: 12,
        group_slug: "elemental-current",
        review_reason: null,
        status: "cancelled",
      },
      title: "Application cancelled",
      type: "applications.cancelled",
    },
  ])("includes application details for $type", (testCase) => {
    const service = new NotificationMessageService({
      fullpartyWebBaseUrl: "https://fullparty.gg",
    });

    expectNotificationMessage(
      service.createDmMessage(
        createNotificationDelivery({
          actionUrl: testCase.actionUrl,
          category: "applications",
          params: testCase.params,
          payload: testCase.payload,
          type: testCase.type,
        }),
      ),
      {
        actionLabel: testCase.actionLabel,
        actionUrl: testCase.actionUrl,
        color: testCase.color,
        description: testCase.description,
        footerText: "📋 FullParty • Applications",
        title: testCase.title,
      },
    );
  });

  it("includes assignment update details when present", () => {
    const service = new NotificationMessageService({
      fullpartyWebBaseUrl: "https://fullparty.gg",
    });

    expectNotificationMessage(
      service.createDmMessage(
        createNotificationDelivery({
          actionUrl: "http://fullparty.test/en/account/applications",
          category: "assignments",
          params: {
            activity: "Activity #6921",
            character: "Giki Chomusuke",
            group: "asd",
            slot: "Party A 7",
            slot_group: "Party A",
          },
          payload: {
            activity_id: 6921,
            activity_title: "Activity #6921",
            application_id: null,
            character_id: 321,
            character_name: "Giki Chomusuke",
            group_id: 21,
            group_slug: "asdd",
            slot_group: "Party A",
            slot_id: 72719,
            slot_key: "party-a-slot-7",
            slot_label: "Party A 7",
            starts_at: "2026-05-30T01:00:00+00:00",
            status: "approved",
          },
          type: "assignments.assigned",
        }),
      ),
      {
        actionLabel: "View assignment",
        actionUrl: "http://fullparty.test/en/account/applications",
        color: 0x22c55e,
        description:
          "You were assigned for Activity #6921 in asd to the roster.\n\nScheduled start: <t:1780102800:F> (<t:1780102800:R>)\nCharacter: Giki Chomusuke\nSlot: Party A",
        footerText: "🎯 FullParty • Assignments",
        title: "Roster assignment updated",
      },
    );
  });

  it("includes roster publication assignment details when present", () => {
    const service = new NotificationMessageService({
      fullpartyWebBaseUrl: "https://fullparty.gg",
    });

    expectNotificationMessage(
      service.createDmMessage(
        createNotificationDelivery({
          actionUrl: "http://fullparty.test/en/account/applications",
          category: "assignments",
          params: {
            activity: "Activity #6921",
            character: "Giki Chomusuke",
            group: "asd",
            slot: "Party A 2",
            slot_group: "Party A",
          },
          payload: {
            activity_id: 6921,
            activity_title: "Activity #6921",
            application_id: null,
            character_id: 321,
            character_name: "Giki Chomusuke",
            group_id: 21,
            group_slug: "asdd",
            slot_group: "Party A",
            slot_id: 72714,
            slot_key: "party-a-slot-2",
            slot_label: "Party A 2",
            starts_at: "2026-05-30T01:00:00+00:00",
            status: "approved",
          },
          type: "assignments.roster_published_assigned",
        }),
      ),
      {
        actionLabel: "View roster",
        actionUrl: "http://fullparty.test/en/account/applications",
        color: 0x22c55e,
        description:
          "Your roster assignment for Activity #6921 in asd was published.\n\nScheduled start: <t:1780102800:F> (<t:1780102800:R>)\nCharacter: Giki Chomusuke\nSlot: Party A",
        footerText: "🎯 FullParty • Assignments",
        title: "Roster published",
      },
    );
  });

  it("includes designation assignment details when present", () => {
    const service = new NotificationMessageService({
      fullpartyWebBaseUrl: "https://fullparty.gg",
    });

    expectNotificationMessage(
      service.createDmMessage(
        createNotificationDelivery({
          actionUrl: "http://fullparty.test/en/account/applications",
          category: "assignments",
          params: {
            activity: "Activity #6922",
            class: "Astrologian",
            class_shorthand: "AST",
            character: "Giki Chomusuke",
            designation: "Raid Leader",
            group: "asd",
            position: "Main Tank",
            position_key: "mt",
            slot: "Party 2",
            slot_group: "Party",
          },
          payload: {
            activity_id: 6922,
            character_id: 321,
            character_name: "Giki Chomusuke",
            designation_assigned: true,
            designation_key: "raid_leader",
            designation_label: "Raid Leader",
            group_id: 21,
            group_slug: "asdd",
            roster: {
              fields: [
                {
                  display_value: "Astrologian",
                  key: "character_class",
                  label: "Character Class",
                  meta: {
                    icon_url: "https://example.com/astrologian.png",
                    name: "Astrologian",
                    role: "healer",
                    shorthand: "AST",
                  },
                  type: "single_select",
                  value: {
                    id: 11,
                    name: "Astrologian",
                    role: "healer",
                    shorthand: "AST",
                  },
                },
                {
                  display_value: "Main Tank",
                  key: "raid_position",
                  label: "Raid Position",
                  meta: {
                    key: "mt",
                    label: {
                      en: "Main Tank",
                    },
                  },
                  type: "single_select",
                  value: {
                    key: "mt",
                    label: {
                      en: "Main Tank",
                    },
                  },
                },
              ],
              group_label: "Party",
              group_key: "party",
              position_in_group: 2,
              selected_class: {
                id: 11,
                name: "Astrologian",
                role: "healer",
                shorthand: "AST",
              },
              selected_position: {
                key: "mt",
                label: "Main Tank",
              },
              slot_key: "party-slot-2",
              slot_label: "Party 2",
            },
            slot_group: "Party",
            slot_id: 72770,
            slot_key: "party-slot-2",
            slot_label: "Party 2",
          },
          type: "assignments.designation_assigned",
        }),
      ),
      {
        actionLabel: "View roster",
        actionUrl: "http://fullparty.test/en/account/applications",
        color: 0x22c55e,
        description:
          "Raid Leader was assigned to you for Activity #6922 in asd.\n\nCharacter: Giki Chomusuke\nCharacter Class: Astrologian\nRaid Position: Main Tank\nSlot: Party",
        footerText: "🎯 FullParty • Assignments",
        thumbnailUrl: "https://example.com/astrologian.png",
        title: "Raid Leader assigned",
      },
    );
  });

  it("includes marked missing assignment details when present", () => {
    const service = new NotificationMessageService({
      fullpartyWebBaseUrl: "https://fullparty.gg",
    });

    expectNotificationMessage(
      service.createDmMessage(
        createNotificationDelivery({
          actionUrl: "http://fullparty.test/en/groups/asdd/activities/6929",
          category: "assignments",
          params: {
            activity: "AAC Cruiserweight M1 (Savage)",
            character: "Giki Chomusuke",
            group: "asd",
            slot: "Party 7",
            slot_group: "Party",
          },
          payload: {
            activity_id: 6929,
            activity_title: "AAC Cruiserweight M1 (Savage)",
            application_id: null,
            attendance_status: "missing",
            character_id: 321,
            character_name: "Giki Chomusuke",
            group_id: 21,
            group_slug: "asdd",
            roster: {
              group_key: "party",
              group_label: "Party",
              position_in_group: 7,
              slot_key: "party-slot-7",
              slot_label: "Party 7",
            },
            slot_group: "Party",
            slot_id: 72887,
            slot_key: "party-slot-7",
            slot_label: "Party 7",
            status: "approved",
          },
          type: "assignments.marked_missing",
        }),
      ),
      {
        actionLabel: "View roster",
        actionUrl: "http://fullparty.test/en/groups/asdd/activities/6929",
        color: 0xf59e0b,
        description:
          "You were marked missing for AAC Cruiserweight M1 (Savage) in asd.\n\nCharacter: Giki Chomusuke\nSlot: Party\nAttendance: Missing",
        footerText: "🎯 FullParty • Assignments",
        title: "Marked missing",
      },
    );
  });

  it("includes restored missing assignment details when present", () => {
    const service = new NotificationMessageService({
      fullpartyWebBaseUrl: "https://fullparty.gg",
    });

    expectNotificationMessage(
      service.createDmMessage(
        createNotificationDelivery({
          actionUrl: "http://fullparty.test/en/groups/asdd/activities/6929",
          category: "assignments",
          params: {
            activity: "AAC Cruiserweight M1 (Savage)",
            character: "Giki Chomusuke",
            group: "asd",
            slot_group: "Party",
          },
          payload: {
            activity_id: 6929,
            activity_title: "AAC Cruiserweight M1 (Savage)",
            attendance_status: "available",
            character_id: 321,
            character_name: "Giki Chomusuke",
            group_id: 21,
            group_slug: "asdd",
            slot_group: "Party",
          },
          type: "assignments.missing_restored",
        }),
      ),
      {
        actionLabel: "View roster",
        actionUrl: "http://fullparty.test/en/groups/asdd/activities/6929",
        color: 0x22c55e,
        description:
          "You are no longer marked missing for AAC Cruiserweight M1 (Savage) in asd.\n\nCharacter: Giki Chomusuke\nSlot: Party\nAttendance: Available",
        footerText: "🎯 FullParty • Assignments",
        title: "Missing status restored",
      },
    );
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

  it("includes run cancellation details when present", () => {
    const service = new NotificationMessageService({
      fullpartyWebBaseUrl: "https://fullparty.gg",
    });

    expectNotificationMessage(
      service.createDmMessage(
        createNotificationDelivery({
          actionUrl: "http://fullparty.test/en/groups/asdd/activities/6927",
          category: "runs_and_reminders",
          params: {
            activity: "Activity #6927",
            group: "asd",
          },
          payload: {
            activity_id: 6927,
            activity_title: "Activity #6927",
            group_id: 21,
            group_slug: "asdd",
            starts_at: "2026-05-30T01:00:00+00:00",
            status: "cancelled",
          },
          type: "runs.cancelled",
        }),
      ),
      {
        actionLabel: "View run",
        actionUrl: "http://fullparty.test/en/groups/asdd/activities/6927",
        color: 0xd83c3e,
        description:
          "Activity #6927 in asd was cancelled.\n\nScheduled start: <t:1780102800:F> (<t:1780102800:R>)\nStatus: Cancelled",
        footerText: "🗓️ FullParty • Runs And Reminders",
        title: "Run cancelled",
      },
    );
  });

  it("includes run completion details when present", () => {
    const service = new NotificationMessageService({
      fullpartyWebBaseUrl: "https://fullparty.gg",
    });

    expectNotificationMessage(
      service.createDmMessage(
        createNotificationDelivery({
          actionUrl: "http://fullparty.test/en/groups/asdd/activities/6928",
          category: "runs_and_reminders",
          params: {
            activity: "Activity #6928",
            group: "asd",
          },
          payload: {
            activity_id: 6928,
            activity_title: "Activity #6928",
            completion: {
              completed_at: "2026-05-29T23:38:46+00:00",
              furthest_progress_key: null,
              furthest_progress_label: null,
              furthest_progress_percent: 34,
              milestones: [
                {
                  best_progress_percent: 34,
                  kills: 3,
                  milestone_key: "m5s",
                  milestone_label: {
                    de: "AAC Cruiserweight M1",
                    en: "AAC Cruiserweight M1",
                    fr: "AAC Cruiserweight M1",
                    ja: "AAC Cruiserweight M1",
                  },
                  notes: null,
                  source: "manual",
                },
              ],
              progress_entry_mode: "manual",
              progress_link_url: null,
              progress_notes: null,
              progress_recorded_at: "2026-05-29T23:38:46+00:00",
              progress_recorded_by_user_id: 322,
            },
            group_id: 21,
            group_slug: "asdd",
            starts_at: "2026-05-30T01:00:00+00:00",
            status: "complete",
          },
          type: "runs.completed",
        }),
      ),
      {
        actionLabel: "View run",
        actionUrl: "http://fullparty.test/en/groups/asdd/activities/6928",
        color: 0x22c55e,
        description:
          "Activity #6928 in asd was completed.\n\nScheduled start: <t:1780102800:F> (<t:1780102800:R>)\nStatus: Complete\nCompleted at: <t:1780097926:F> (<t:1780097926:R>)\nProgress: 34%\nEntry mode: Manual\nMilestones:\n- AAC Cruiserweight M1: 34% best, 3 kills",
        footerText: "🗓️ FullParty • Runs And Reminders",
        title: "Run completed",
      },
    );
  });

  it("includes run starting soon details when present", () => {
    const service = new NotificationMessageService({
      fullpartyWebBaseUrl: "https://fullparty.gg",
    });

    expectNotificationMessage(
      service.createDmMessage(
        createNotificationDelivery({
          actionUrl: "http://fullparty.test/en/groups/asdd/activities/6930",
          category: "runs_and_reminders",
          params: {
            activity: "SOme Custom Tiutle",
            group: "asd",
          },
          payload: {
            activity_id: 6930,
            activity_title: "SOme Custom Tiutle",
            group_id: 21,
            group_slug: "asdd",
            starts_at: "2026-05-30T01:20:00+00:00",
            status: "assigned",
          },
          type: "runs.starting_soon",
        }),
      ),
      {
        actionLabel: "View run",
        actionUrl: "http://fullparty.test/en/groups/asdd/activities/6930",
        color: 0xf59e0b,
        description:
          "SOme Custom Tiutle in asd starts soon.\n\nScheduled start: <t:1780104000:F> (<t:1780104000:R>)\nStatus: Assigned",
        footerText: "🗓️ FullParty • Runs And Reminders",
        title: "Run starting soon",
      },
    );
  });

  it("includes run starting now details when present", () => {
    const service = new NotificationMessageService({
      fullpartyWebBaseUrl: "https://fullparty.gg",
    });

    expectNotificationMessage(
      service.createDmMessage(
        createNotificationDelivery({
          actionUrl: "http://fullparty.test/groups/static-name/activities/123/overview",
          category: "runs_and_reminders",
          params: {
            activity: "AAC Light-heavyweight M4 (Savage)",
            group: "Static Name",
          },
          payload: {
            activity_id: 123,
            activity_title: "AAC Light-heavyweight M4 (Savage)",
            group_id: 5,
            group_slug: "static-name",
            starts_at: "2026-05-30T20:00:00+00:00",
            status: "upcoming",
          },
          type: "runs.starting_now",
        }),
      ),
      {
        actionLabel: "View run",
        actionUrl: "http://fullparty.test/groups/static-name/activities/123/overview",
        color: 0xf59e0b,
        description:
          "AAC Light-heavyweight M4 (Savage) in Static Name is starting now.\n\nScheduled start: <t:1780171200:F> (<t:1780171200:R>)\nStatus: Upcoming",
        footerText: "🗓️ FullParty • Runs And Reminders",
        title: "Run starting now",
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
  Progress: "📈",
  "Raid Position": "📍",
  Reason: "📝",
  "Scheduled start": "🕒",
  Slot: "🎯",
  Status: "📌",
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
