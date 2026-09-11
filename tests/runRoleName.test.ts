import { describe, expect, it } from "vitest";
import { extractGuildRunReminderData } from "../src/fullparty/guildRunAssignmentPayload.js";
import { guildRunReminderDataSchema } from "../src/guildAutomation/runReminderTypes.js";
import { createRunRoleName } from "../src/guildAutomation/runRoleName.js";

function reminder(extra: Record<string, unknown> = {}) {
  return guildRunReminderDataSchema.parse({
    discord_guild_id: "guild-id",
    run_id: 123,
    reminder_type: "starting_soon",
    type: "runs.starting_soon",
    starts_at: "2026-09-10T18:00:00Z",
    activity_title: "Newbie run! Conty takes on bridges?? Newbie to Bridges prog",
    activity: "Another custom run title",
    ...extra,
  });
}

describe("run role names", () => {
  it.each(["starting_soon", "starting_now"] as const)(
    "uses the English nested activity type for %s webhooks, not the display title",
    (reminderType) => {
      const data = reminder({
        reminder_type: reminderType,
        type: `runs.${reminderType}`,
        run: {
          display_name: "A very long custom bridge progression title",
          activity_type: {
            name: { de: "German activity name", en: "Delubrum Reginae (Savage)" },
          },
        },
      });
      expect(createRunRoleName(data)).toBe("Run: Delubrum Reginae (Savage) 18:00 UTC");
    },
  );

  it("uses data.activity_type.name.en from the run API after normalization", () => {
    const data = extractGuildRunReminderData(
      {
        data: {
          id: 123,
          starts_at: "2026-09-10T19:00:00+01:00",
          display_name: "Custom prog night",
          activity_type: { name: { en: "Delubrum Reginae (Savage)" } },
          participants: [],
        },
      },
      { discordGuildId: "guild-id" },
    );

    expect(createRunRoleName(data)).toBe("Run: Delubrum Reginae (Savage) 18:00 UTC");
    expect(data.activity_title).toBe("Custom prog night");
  });

  it("preserves the nested run activity type in the role-assignment API envelope", () => {
    const data = extractGuildRunReminderData(
      {
        data: {
          run: {
            id: 123,
            starts_at: "2026-09-10T18:00:00Z",
            display_name: "Custom prog night",
            activity_type: { name: { en: "Delubrum Reginae (Savage)" } },
          },
          participants: [],
        },
      },
      { discordGuildId: "guild-id" },
    );

    expect(createRunRoleName(data)).toBe("Run: Delubrum Reginae (Savage) 18:00 UTC");
  });

  it.each([
    undefined,
    null,
    {},
    { name: null },
    { name: { en: null } },
    { name: { en: "   " } },
    { name: { de: "German activity name" } },
  ])(
    "falls back to the run ID when the English activity type is unavailable: %j",
    (activityType) => {
      expect(createRunRoleName(reminder({ run: { activity_type: activityType } }))).toBe(
        "Run: #123 18:00 UTC",
      );
    },
  );

  it("keeps the start time within the 100-character role-name limit", () => {
    const name = createRunRoleName(
      reminder({
        run: { activity_type: { name: { en: "A".repeat(150) } } },
      }),
    );
    expect(name).toHaveLength(100);
    expect(name).toBe(`Run: ${"A".repeat(82)}... 18:00 UTC`);
  });

  it("uses the nested start time when the root start time is absent", () => {
    const data = reminder({
      starts_at: undefined,
      run: {
        starts_at: "2026-09-10T08:05:00Z",
        activity_type: { name: { en: "Delubrum Reginae (Savage)" } },
      },
    });
    expect(createRunRoleName(data)).toBe("Run: Delubrum Reginae (Savage) 08:05 UTC");
  });

  it.each([undefined, "invalid-date"])(
    "does not invent a missing/invalid start time: %s",
    (startsAt) => {
      const data = reminder({
        starts_at: startsAt,
        activity_type: { name: { en: "Delubrum Reginae (Savage)" } },
      });
      expect(createRunRoleName(data)).toBe("Run: Delubrum Reginae (Savage)");
    },
  );
});
