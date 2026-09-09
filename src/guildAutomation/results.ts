import type { RunReminderFailure } from "./types.js";

export type RoleAssignmentContext = {
  discordGuildId: string;
  reminderType: "starting_soon" | "starting_now";
  requestedUserCount: number;
  roleDryRun?: boolean | undefined;
  runId: number;
  templateOverrideActivityId?: number | undefined;
  templateOverrideActivityName?: string | undefined;
  templateRoleSource: "default" | "none" | "override";
  type: "runs.starting_soon" | "runs.starting_now";
};

export type RoleAssignmentResult = RoleAssignmentContext & {
  assignedUserCount: number;
  failedUserCount: number;
  roleProcessingTimeMs: number;
  copiedOverwriteCount?: number | undefined;
  createdRunRole?: boolean | undefined;
  failures?: RunReminderFailure[] | undefined;
  roleId?: string | undefined;
  roleName?: string | undefined;
  skippedReason?: string | undefined;
  templateRoleId?: string | undefined;
};

export type NicknameSyncResult = {
  nicknameRequestedUserCount: number;
  nicknameSyncEnabled: boolean;
  nicknameFailedUserCount: number;
  nicknameSkippedUserCount: number;
  nicknameSyncedUserCount: number;
  nicknameFailures?: RunReminderFailure[] | undefined;
  nicknameProcessingTimeMs?: number | undefined;
  nicknameSkippedReason?: string | undefined;
};

export type RunReminderResult = RoleAssignmentResult & NicknameSyncResult;

export type RoleCleanupResult = {
  discordGuildId: string;
  runId: number;
  type: "runs.completed" | "runs.cancelled";
  deletedRoleCount: number;
  failedRoleCount: number;
  failures?: RunReminderFailure[] | undefined;
  roleId?: string | undefined;
  roleName?: string | undefined;
  skippedReason?: string | undefined;
};
