import { z } from "zod";
import type {
  AdminAutomationRunRecord,
  AdminAutomationRunStatus,
  AdminAutomationRunType,
  AdminBotEventRecord,
  AdminBotEventStatus,
  AdminCommandUsageRecord,
  AdminCommandUsageStatus,
  AdminDashboardMetrics,
  AdminFailureRecord,
  AdminGuildDashboardRecord,
  AdminGuildDashboardTotals,
  AdminGuildHealthIssue,
  AdminGuildHealthStatus,
  AdminGuildMessageRecord,
  AdminGuildMessageStatus,
  AdminGuildRecord,
  AdminLabeledCount,
  AdminMetricBucket,
  AdminQueueSummary,
  DashboardPayload,
  DashboardResponse,
  HealthIssue,
  HealthSnapshot,
  MemberCacheRefreshResponse,
  MemberCacheRefreshResult,
  RuntimeLogEntry,
  RuntimeLogsResponse,
  UserDmQueueSnapshot,
  UserDmQueueSummary,
} from "./contracts.js";

export const healthIssueSchema: z.ZodType<HealthIssue> = z.object({
  check: z.string(),
  details: z.record(z.string(), z.unknown()),
  occurredAt: z.union([z.null(), z.string()]),
  reason: z.string(),
  severity: z.enum(["info", "warn", "error"]),
  status: z.string(),
});

export const adminFailureRecordSchema: z.ZodType<AdminFailureRecord> = z.object({
  action: z.string(),
  affectsHealth: z.boolean(),
  details: z.unknown(),
  discordGuildId: z.union([z.null(), z.string()]),
  discordUserId: z.union([z.null(), z.string()]),
  errorCode: z.union([z.null(), z.string()]),
  eventType: z.union([z.null(), z.string()]),
  id: z.number(),
  message: z.string(),
  occurredAt: z.string(),
  runId: z.union([z.null(), z.number()]),
  severity: z.string(),
  source: z.string(),
});

export const adminGuildRecordSchema: z.ZodType<AdminGuildRecord> = z.object({
  botLogChannelId: z.union([z.null(), z.string()]),
  botModeratorRoleId: z.union([z.null(), z.string()]),
  botPermissions: z.union([z.null(), z.string()]),
  cachedMemberCount: z.union([z.null(), z.number()]),
  discordGuildId: z.string(),
  lastError: z.union([z.null(), z.string()]),
  lastFullRefreshAt: z.union([z.null(), z.string()]),
  lastSeenAt: z.union([z.null(), z.string()]),
  linked: z.boolean(),
  linkedAt: z.union([z.null(), z.string()]),
  memberCount: z.union([z.null(), z.number()]),
  name: z.union([z.null(), z.string()]),
  nextRefreshAfter: z.union([z.null(), z.string()]),
  refreshStatus: z.union([z.null(), z.string()]),
  runAnnouncementChannelId: z.union([z.null(), z.string()]),
  syncDiscordNamesToFf14: z.boolean(),
  unavailable: z.boolean(),
  upcomingRaiderRoleId: z.union([z.null(), z.string()]),
  updatedAt: z.union([z.null(), z.string()]),
});

export const adminGuildHealthStatusSchema: z.ZodType<AdminGuildHealthStatus> = z.enum([
  "healthy",
  "degraded",
  "unhealthy",
]);

export const adminGuildHealthIssueSchema: z.ZodType<AdminGuildHealthIssue> = z.object({
  key: z.string(),
  occurredAt: z.union([z.null(), z.string()]),
  reason: z.string(),
  severity: z.enum(["warn", "error"]),
  status: adminGuildHealthStatusSchema,
});

export const adminAutomationRunTypeSchema: z.ZodType<AdminAutomationRunType> = z.enum([
  "nickname_sync",
  "role_assignment",
  "role_cleanup",
]);

export const adminAutomationRunStatusSchema: z.ZodType<AdminAutomationRunStatus> = z.enum(
  ["completed", "failed", "partial", "skipped"],
);

export const adminAutomationRunRecordSchema: z.ZodType<AdminAutomationRunRecord> =
  z.object({
    automationType: adminAutomationRunTypeSchema,
    discordGuildId: z.union([z.null(), z.string()]),
    durationMs: z.union([z.null(), z.number()]),
    eventType: z.union([z.null(), z.string()]),
    failureCount: z.number(),
    id: z.number(),
    occurredAt: z.string(),
    result: z.unknown(),
    runId: z.union([z.null(), z.number()]),
    skippedCount: z.number(),
    status: adminAutomationRunStatusSchema,
    successCount: z.number(),
  });

export const adminCommandUsageStatusSchema: z.ZodType<AdminCommandUsageStatus> = z.enum([
  "failed",
  "succeeded",
]);

export const adminCommandUsageRecordSchema: z.ZodType<AdminCommandUsageRecord> = z.object(
  {
    commandName: z.string(),
    status: adminCommandUsageStatusSchema,
    discordGuildId: z.union([z.null(), z.string()]),
    discordUserId: z.union([z.null(), z.string()]),
    durationMs: z.union([z.null(), z.number()]),
    errorCode: z.union([z.null(), z.string()]),
    id: z.number(),
    occurredAt: z.string(),
  },
);

export const adminBotEventStatusSchema: z.ZodType<AdminBotEventStatus> = z.enum([
  "failed",
  "accepted",
]);

export const adminBotEventRecordSchema: z.ZodType<AdminBotEventRecord> = z.object({
  status: adminBotEventStatusSchema,
  eventType: z.string(),
  dataType: z.union([z.null(), z.string()]),
  discordGuildId: z.union([z.null(), z.string()]),
  discordUserId: z.union([z.null(), z.string()]),
  errorCode: z.union([z.null(), z.string()]),
  id: z.number(),
  occurredAt: z.string(),
  requestHost: z.union([z.null(), z.string()]),
  requestId: z.union([z.null(), z.string()]),
});

export const adminGuildMessageStatusSchema: z.ZodType<AdminGuildMessageStatus> = z.enum([
  "failed",
  "skipped",
  "sent",
]);

export const adminGuildMessageRecordSchema: z.ZodType<AdminGuildMessageRecord> = z.object(
  {
    status: adminGuildMessageStatusSchema,
    messageType: z.string(),
    channelId: z.union([z.null(), z.string()]),
    discordGuildId: z.union([z.null(), z.string()]),
    errorCode: z.union([z.null(), z.string()]),
    errorMessage: z.union([z.null(), z.string()]),
    id: z.number(),
    messageId: z.union([z.null(), z.string()]),
    occurredAt: z.string(),
  },
);

export const adminGuildDashboardTotalsSchema: z.ZodType<AdminGuildDashboardTotals> =
  z.object({
    automationFailures24h: z.number(),
    automationRuns24h: z.number(),
    commandFailures24h: z.number(),
    commands24h: z.number(),
    eventFailures24h: z.number(),
    events24h: z.number(),
    guildMessageFailures24h: z.number(),
    guildMessagesSent24h: z.number(),
    healthFailures24h: z.number(),
    ignoredFailures24h: z.number(),
  });

export const adminMetricBucketSchema: z.ZodType<AdminMetricBucket> = z.object({
  automationRuns: z.number(),
  commands: z.number(),
  dms: z.number(),
  events: z.number(),
  failures: z.number(),
  guildMessages: z.number(),
  label: z.string(),
});

export const adminGuildDashboardRecordSchema: z.ZodType<AdminGuildDashboardRecord> =
  z.object({
    guild: adminGuildRecordSchema,
    health: z.object({
      issues: z.array(adminGuildHealthIssueSchema),
      status: adminGuildHealthStatusSchema,
    }),
    recent: z.object({
      automationRuns: z.array(adminAutomationRunRecordSchema),
      commandUsages: z.array(adminCommandUsageRecordSchema),
      events: z.array(adminBotEventRecordSchema),
      failures: z.array(adminFailureRecordSchema),
      guildMessages: z.array(adminGuildMessageRecordSchema),
    }),
    totals: adminGuildDashboardTotalsSchema,
    trends: z.object({
      daily7d: z.array(adminMetricBucketSchema),
    }),
  });

export const healthSnapshotSchema: z.ZodType<HealthSnapshot> = z.object({
  checks: z.record(
    z.string(),
    z.looseObject({
      ok: z.boolean(),
      status: z.string(),
    }),
  ),
  ok: z.boolean(),
  status: z.enum(["healthy", "degraded", "unhealthy"]),
  timestamp: z.string(),
  uptime_seconds: z.number(),
});

export const adminLabeledCountSchema: z.ZodType<AdminLabeledCount> = z.object({
  label: z.string(),
  value: z.number(),
});

export const adminDashboardMetricsSchema: z.ZodType<AdminDashboardMetrics> = z.object({
  breakdowns: z.object({
    automationStatuses24h: z.array(adminLabeledCountSchema),
    commandNames24h: z.array(adminLabeledCountSchema),
    dmStatuses24h: z.array(adminLabeledCountSchema),
    eventTypes24h: z.array(adminLabeledCountSchema),
    guildMessageStatuses24h: z.array(adminLabeledCountSchema),
    notificationTypes24h: z.array(adminLabeledCountSchema),
  }),
  totals: z.object({
    automationFailures24h: z.number(),
    automationRuns24h: z.number(),
    commandsFailed24h: z.number(),
    commandsUsed24h: z.number(),
    dmsFailed24h: z.number(),
    dmsQueued24h: z.number(),
    dmsSent24h: z.number(),
    events24h: z.number(),
    eventsFailed24h: z.number(),
    failures24h: z.number(),
    guildMessagesFailed24h: z.number(),
    guildMessagesSent24h: z.number(),
  }),
  trends: z.object({
    daily7d: z.array(adminMetricBucketSchema),
    hourly24h: z.array(adminMetricBucketSchema),
  }),
});

export const adminQueueSummarySchema: z.ZodType<AdminQueueSummary> = z.object({
  jobsByStatus: z.record(z.string(), z.number()),
  oldestQueuedAt: z.union([z.null(), z.string()]),
  recentFailedCount: z.number(),
});

export const userDmQueueSnapshotSchema: z.ZodType<UserDmQueueSnapshot> = z.object({
  discordUserId: z.string(),
  nextAttemptAt: z.union([z.null(), z.string()]),
  queueLength: z.number(),
  sentInWindow: z.number(),
});

export const userDmQueueSummarySchema: z.ZodType<UserDmQueueSummary> = z.object({
  cooldownUsers: z.number(),
  queuedMessages: z.number(),
  queuedUsers: z.number(),
  queues: z.array(userDmQueueSnapshotSchema),
});

export const dashboardPayloadSchema: z.ZodType<DashboardPayload> = z.object({
  diagnostics: z.object({
    healthIssues: z.array(healthIssueSchema),
    recentFailures: z.array(adminFailureRecordSchema),
  }),
  guilds: z.object({
    details: z.array(adminGuildDashboardRecordSchema),
    linked: z.number(),
    records: z.array(adminGuildRecordSchema),
    total: z.number(),
    unavailable: z.number(),
  }),
  health: healthSnapshotSchema,
  metrics: adminDashboardMetricsSchema,
  queue: z.object({
    guildAutomation: adminQueueSummarySchema,
    userDms: userDmQueueSummarySchema,
  }),
});

export const dashboardResponseSchema: z.ZodType<DashboardResponse> = z.object({
  data: dashboardPayloadSchema,
});

export const runtimeLogEntrySchema: z.ZodType<RuntimeLogEntry> = z.object({
  id: z.number(),
  level: z.enum(["info", "warn", "error", "debug", "log"]),
  message: z.string(),
  timestamp: z.string(),
});

export const runtimeLogsResponseSchema: z.ZodType<RuntimeLogsResponse> = z.object({
  data: z.array(runtimeLogEntrySchema),
  meta: z.object({
    directoryPath: z.union([z.null(), z.string()]).optional(),
    enabled: z.boolean().optional(),
    limit: z.number(),
    maxLines: z.number(),
    retentionDays: z.union([z.null(), z.number()]).optional(),
    totalBuffered: z.number(),
  }),
});

export const memberCacheRefreshResultSchema: z.ZodType<MemberCacheRefreshResult> =
  z.object({
    deletedUnavailableGuildCount: z.number(),
    linkedGuildCount: z.number(),
    obsoleteUnavailableGuildCount: z.number().optional(),
    queuedGuildCount: z.number(),
    skippedGuildCount: z.number(),
  });

export const memberCacheRefreshResponseSchema: z.ZodType<MemberCacheRefreshResponse> =
  z.object({
    data: memberCacheRefreshResultSchema,
  });
