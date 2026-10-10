import { MessageFlags, type MessageCreateOptions } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { replyWithAutomationFailureDetails } from "../src/guildAutomation/automationFailureDetails.js";
import { buildRunRoleCleanupLogMessage } from "../src/guildAutomation/presentation/cleanup.js";
import { buildRunReminderNicknameSyncLogMessage } from "../src/guildAutomation/presentation/nickname.js";
import { buildRunReminderRoleSyncLogMessage } from "../src/guildAutomation/presentation/role.js";
import type {
  NicknameSyncResult,
  RoleAssignmentResult,
  RoleCleanupResult,
} from "../src/guildAutomation/results.js";
import {
  guildRunCompletedDataSchema,
  guildRunReminderDataSchema,
} from "../src/guildAutomation/runReminderTypes.js";

const reminder = guildRunReminderDataSchema.parse({
  discord_guild_id: "900100200300400500",
  group_slug: "our-group",
  reminder_type: "starting_soon",
  run_id: 789,
  run_url: "https://fullparty.gg/groups/our-group/runs/789",
  starts_at: "2026-10-12T19:00:00Z",
  type: "runs.starting_soon",
});
const completed = guildRunCompletedDataSchema.parse({
  discord_guild_id: reminder.discord_guild_id,
  group_slug: reminder.group_slug,
  run_id: reminder.run_id,
  run_url: reminder.run_url,
  type: "runs.completed",
});
const nicknameResult: NicknameSyncResult = {
  nicknameRequestedUserCount: 3,
  nicknameSyncEnabled: true,
  nicknameFailedUserCount: 0,
  nicknameSkippedUserCount: 1,
  nicknameSyncedUserCount: 2,
};
const roleResult: RoleAssignmentResult = {
  discordGuildId: reminder.discord_guild_id,
  reminderType: reminder.reminder_type,
  requestedUserCount: 3,
  runId: reminder.run_id,
  templateRoleSource: "default",
  type: reminder.type,
  assignedUserCount: 3,
  failedUserCount: 0,
  roleProcessingTimeMs: 12,
  copiedOverwriteCount: 2,
  createdRunRole: true,
  roleId: "900100200300400501",
  roleName: "Our temporary role",
  templateRoleId: "900100200300400502",
};
const cleanupResult: RoleCleanupResult = {
  discordGuildId: reminder.discord_guild_id,
  runId: reminder.run_id,
  type: "runs.completed",
  deletedRoleCount: 1,
  failedRoleCount: 0,
  roleId: roleResult.roleId,
  roleName: roleResult.roleName,
};

type Component = {
  type: number;
  content?: string;
  components?: Component[];
  accent_color?: number;
  custom_id?: string;
  url?: string;
};

function components(message: MessageCreateOptions): Component[] {
  const roots = message.components as Component[];
  return roots.flatMap(function flatten(component): Component[] {
    return [component, ...(component.components?.flatMap(flatten) ?? [])];
  });
}

function text(message: MessageCreateOptions): string {
  return components(message)
    .map((component) => component.content ?? "")
    .join("\n");
}

function expectV2(message: MessageCreateOptions): void {
  expect(message).toMatchObject({
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  });
  expect(message.embeds).toBeUndefined();
  expect(message.content).toBeUndefined();
  expect(text(message)).toContain("FullParty • Discord Automation");
  expect(
    components(message).some((component) => component.accent_color === 11974326),
  ).toBe(true);
  expect(text(message).length).toBeLessThanOrEqual(4000);
}

describe("approved automation V2 designs", () => {
  it("uses real nickname counts, context, and the run link", () => {
    const message = buildRunReminderNicknameSyncLogMessage(reminder, nicknameResult);
    expectV2(message);
    expect(text(message)).toContain("Nickname Synchronization - Success");
    expect(text(message)).toContain("**Run #789** • Upcoming");
    expect(text(message)).toContain("**Group:** our-group");
    expect(text(message)).toContain("> 2 users updated\n> 1 already correct");
    expect(text(message)).toContain("> 0 users failed");
    expect(text(message)).toContain("All 3 users have the correct nickname.");
    expect(components(message)).toContainEqual(
      expect.objectContaining({ url: reminder.run_url }),
    );
  });

  it.each([
    { synced: 1, skipped: 1, failed: 1, status: "Partial", color: 0xf59e0b },
    { synced: 0, skipped: 0, failed: 3, status: "Failed", color: 0xef4444 },
  ])(
    "preserves nickname $status status and failure styling",
    ({ synced, skipped, failed, status, color }) => {
      const message = buildRunReminderNicknameSyncLogMessage(reminder, {
        ...nicknameResult,
        nicknameSyncedUserCount: synced,
        nicknameSkippedUserCount: skipped,
        nicknameFailedUserCount: failed,
        nicknameFailures: [{ discordUserId: "our-user", error: "Missing Permissions" }],
      });
      expectV2(message);
      expect(text(message)).toContain(`Nickname Synchronization - ${status}`);
      expect(text(message)).toContain("`our-user`: Missing Permissions");
      expect(components(message)).toContainEqual(
        expect.objectContaining({ accent_color: color }),
      );
    },
  );

  it("does not call disabled nickname targets already correct", () => {
    const message = buildRunReminderNicknameSyncLogMessage(reminder, {
      ...nicknameResult,
      nicknameSyncedUserCount: 0,
      nicknameSkippedUserCount: 3,
      nicknameSkippedReason: "nickname_sync_disabled",
    });
    expectV2(message);
    expect(text(message)).toContain("Nickname Synchronization - Skipped");
    expect(text(message)).toContain("Checked **3** users.");
    expect(text(message)).toContain("Nickname sync is disabled in `/setup`.");
    expect(text(message)).not.toContain("already correct");
  });

  it.each([true, false])(
    "renders role success with createdRunRole=%s",
    (createdRunRole) => {
      const message = buildRunReminderRoleSyncLogMessage(reminder, {
        ...roleResult,
        createdRunRole,
      });
      expectV2(message);
      expect(text(message)).toContain("Role Assignment - Success");
      expect(text(message)).toContain("> **3 / 3** users assigned");
      expect(text(message)).toContain(
        "> <@&900100200300400502> > <@&900100200300400501>",
      );
      expect(text(message)).toContain("> 2 overwrites copied");
      expect(text(message)).toContain(
        createdRunRole ? "A new role was created" : "The existing run role was reused",
      );
    },
  );

  it("does not claim a run role is ready when role creation failed", () => {
    const message = buildRunReminderRoleSyncLogMessage(reminder, {
      ...roleResult,
      assignedUserCount: 0,
      failedUserCount: 3,
      roleId: undefined,
      failures: [{ discordUserId: "*", error: "Role creation failed" }],
    });
    expectV2(message);
    expect(text(message)).toContain("Role Assignment - Failed");
    expect(text(message)).toContain("No users could be assigned a run role.");
    expect(text(message)).not.toContain("The run role is ready");
  });

  it("shows the actual skipped reason and configured template", () => {
    const message = buildRunReminderRoleSyncLogMessage(reminder, {
      ...roleResult,
      assignedUserCount: 0,
      failedUserCount: 3,
      roleId: undefined,
      skippedReason: "bot_missing_manage_roles",
      copiedOverwriteCount: 0,
    });
    expectV2(message);
    expect(text(message)).toContain("Role Assignment - Skipped");
    expect(text(message)).toContain("The bot needs the Manage Roles permission");
    expect(text(message)).toContain("> <@&900100200300400502> > Not created");
    expect(text(message)).toContain("No assignments attempted");
  });

  it("keeps undesigned dry-run messages as legacy embeds", () => {
    const message = buildRunReminderRoleSyncLogMessage(reminder, {
      ...roleResult,
      roleDryRun: true,
    });
    expect(message.flags).toBeUndefined();
    expect(message.embeds).toEqual([
      expect.objectContaining({ title: "🧪 Role Assignment Dry Run - Complete" }),
    ]);
  });

  it("preserves failure drilldown and unlinked-user details", async () => {
    const error = "A long failure reason ".repeat(20);
    const data = {
      ...reminder,
      unlinked_participants: [{ character: { name: "Unlinked Person", world: "Alpha" } }],
    };
    const message = buildRunReminderRoleSyncLogMessage(data, {
      ...roleResult,
      assignedUserCount: 1,
      failedUserCount: 2,
      failures: [{ discordUserId: "failing-user", error }],
    });
    const customId = components(message).find((component) =>
      component.custom_id?.startsWith("automationfailures:"),
    )?.custom_id;
    expect(customId).toBeDefined();
    const reply = vi.fn().mockResolvedValue(undefined);
    const followUp = vi.fn().mockResolvedValue(undefined);
    await replyWithAutomationFailureDetails({ customId, reply, followUp } as never);
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(error.slice(0, 350)) as string,
        allowedMentions: { parse: [] },
      }),
    );
    expect(JSON.stringify(reply.mock.calls)).toContain("Unlinked Person [Alpha]");
    expect(text(message)).not.toContain(error);
  });

  it.each(["runs.completed", "runs.cancelled"] as const)(
    "renders %s cleanup without role counters or dead role mentions",
    (type) => {
      const message = buildRunRoleCleanupLogMessage(
        { ...completed, type },
        { ...cleanupResult, type },
      );
      expectV2(message);
      expect(text(message)).toContain("Run Role Cleanup - Success");
      expect(text(message)).toContain(
        type === "runs.cancelled" ? "• Cancelled" : "• Completed",
      );
      expect(text(message)).toContain(
        "> `Our temporary role`\n> ID: `900100200300400501`",
      );
      expect(text(message)).not.toContain("<@&900100200300400501>");
      expect(text(message)).not.toContain("Deleted Roles");
      expect(text(message)).not.toContain("Failed Deletes");
      expect(components(message)).toContainEqual(
        expect.objectContaining({ url: completed.run_url }),
      );
    },
  );

  it("reports already-absent roles truthfully", () => {
    const message = buildRunRoleCleanupLogMessage(completed, {
      ...cleanupResult,
      deletedRoleCount: 0,
    });
    expect(text(message)).toContain("already absent from Discord");
    expect(text(message)).not.toContain("was deleted after");
  });

  it("keeps the active role mention and actual error on cleanup failure", () => {
    const message = buildRunRoleCleanupLogMessage(completed, {
      ...cleanupResult,
      deletedRoleCount: 0,
      failedRoleCount: 1,
      failures: [{ discordUserId: "*", error: "Missing Manage Roles" }],
    });
    expectV2(message);
    expect(text(message)).toContain("Run Role Cleanup - Failed");
    expect(text(message)).toContain("<@&900100200300400501>");
    expect(text(message)).toContain("Missing Manage Roles");
    expect(
      components(message).some((component) =>
        component.custom_id?.startsWith("automationfailures:"),
      ),
    ).toBe(true);
  });

  it("renders cleanup skipped when no active mapping exists", () => {
    const message = buildRunRoleCleanupLogMessage(completed, {
      ...cleanupResult,
      deletedRoleCount: 0,
      roleId: undefined,
      roleName: undefined,
      skippedReason: "run_role_mapping_not_found",
    });
    expectV2(message);
    expect(text(message)).toContain("Run Role Cleanup - Skipped");
    expect(text(message)).toContain("No active run role mapped");
    expect(text(message)).toContain("No role deletion was attempted.");
  });

  it("omits the View Run link when the website has not supplied a URL", () => {
    const message = buildRunRoleCleanupLogMessage(
      { ...completed, run_url: undefined },
      cleanupResult,
    );
    expectV2(message);
    expect(components(message).some((component) => component.url)).toBe(false);
    expect(JSON.stringify(message)).not.toContain("https://fullparty.gg");
  });

  it("bounds failure summaries while retaining the complete details button", () => {
    const message = buildRunReminderNicknameSyncLogMessage(
      { ...reminder, group_slug: "x".repeat(5000) },
      {
        ...nicknameResult,
        nicknameFailedUserCount: 20,
        nicknameFailures: Array.from({ length: 20 }, (_, index) => ({
          discordUserId: `${String(index)}-${"subject".repeat(150)}`,
          error: "error".repeat(150),
        })),
      },
    );
    expectV2(message);
    expect(
      components(message).some((component) =>
        component.custom_id?.startsWith("automationfailures:"),
      ),
    ).toBe(true);
  });
});
