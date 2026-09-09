import type {
  AdminDashboardMetrics,
  AdminFailureRecord,
  AdminGuildDashboardRecord,
  AdminGuildRecord,
  AdminQueueSummary,
} from "./telemetry.js";

export type * from "./telemetry.js";

export type HealthIssue = {
  check: string;
  details: Record<string, unknown>;
  occurredAt: string | null;
  reason: string;
  severity: "info" | "warn" | "error";
  status: string;
};

export type HealthSnapshot = {
  checks: Record<string, { ok: boolean; status: string; [key: string]: unknown }>;
  ok: boolean;
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  uptime_seconds: number;
};

export type UserDmQueueSnapshot = {
  discordUserId: string;
  nextAttemptAt: string | null;
  queueLength: number;
  sentInWindow: number;
};

export type UserDmQueueSummary = {
  cooldownUsers: number;
  queuedMessages: number;
  queuedUsers: number;
  queues: UserDmQueueSnapshot[];
};

export type DashboardPayload = {
  diagnostics: { healthIssues: HealthIssue[]; recentFailures: AdminFailureRecord[] };
  guilds: {
    details: AdminGuildDashboardRecord[];
    linked: number;
    records: AdminGuildRecord[];
    total: number;
    unavailable: number;
  };
  health: HealthSnapshot;
  metrics: AdminDashboardMetrics;
  queue: { guildAutomation: AdminQueueSummary; userDms: UserDmQueueSummary };
};

export type DashboardResponse = { data: DashboardPayload };

export type RuntimeLogEntry = {
  id: number;
  level: "debug" | "error" | "info" | "log" | "warn";
  message: string;
  timestamp: string;
};

export type RuntimeLogsResponse = {
  data: RuntimeLogEntry[];
  meta: {
    directoryPath?: string | null | undefined;
    enabled?: boolean | undefined;
    limit: number;
    maxLines: number;
    retentionDays?: number | null | undefined;
    totalBuffered: number;
  };
};

export type MemberCacheRefreshResult = {
  deletedUnavailableGuildCount: number;
  linkedGuildCount: number;
  obsoleteUnavailableGuildCount?: number | undefined;
  queuedGuildCount: number;
  skippedGuildCount: number;
};

export type MemberCacheRefreshResponse = { data: MemberCacheRefreshResult };
