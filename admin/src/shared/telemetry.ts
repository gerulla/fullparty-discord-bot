export type AdminBotEventStatus = "accepted" | "failed";

export type AdminDmDeliveryStatus = "queued" | "sent" | "failed";

export type AdminCommandUsageStatus = "succeeded" | "failed";

export type AdminGuildMessageStatus = "sent" | "failed" | "skipped";

export type AdminAutomationRunType = "nickname_sync" | "role_assignment" | "role_cleanup";

export type AdminAutomationRunStatus = "completed" | "failed" | "partial" | "skipped";

export type AdminStore = {
  close?(): void;
  getAutomationRuns(limit?: number): Promise<AdminAutomationRunRecord[]>;
  getCommandUsages(limit?: number): Promise<AdminCommandUsageRecord[]>;
  getDashboardMetrics(now?: Date): Promise<AdminDashboardMetrics>;
  getDmDeliveries(limit?: number): Promise<AdminDmDeliveryRecord[]>;
  getEvents(limit?: number): Promise<AdminBotEventRecord[]>;
  getFailures(limit?: number): Promise<AdminFailureRecord[]>;
  getGuildDashboards(now?: Date): Promise<AdminGuildDashboardRecord[]>;
  getGuildMessages(limit?: number): Promise<AdminGuildMessageRecord[]>;
  getGuilds(): Promise<AdminGuildRecord[]>;
  getQueueSummary(): Promise<AdminQueueSummary>;
  getSummary(now?: Date): Promise<AdminTelemetrySummary>;
  recordAutomationRun(input: AdminAutomationRunInput): Promise<void>;
  recordBotEvent(input: AdminBotEventInput): Promise<void>;
  recordCommandUsage(input: AdminCommandUsageInput): Promise<void>;
  recordDmDelivery(input: AdminDmDeliveryInput): Promise<void>;
  recordGuildMessage(input: AdminGuildMessageInput): Promise<void>;
  recordGuildRuntime(input: AdminGuildRuntimeInput): Promise<void>;
};

export type AdminBotEventInput = {
  dataType?: string | undefined;
  discordGuildId?: string | undefined;
  discordUserId?: string | undefined;
  errorCode?: string | undefined;
  eventType: string;
  occurredAt?: string | undefined;
  requestHost?: string | undefined;
  requestId?: string | undefined;
  status: AdminBotEventStatus;
};

export type AdminDmDeliveryInput = {
  discordUserId: string;
  errorCode?: string | undefined;
  errorMessage?: string | undefined;
  eventType?: string | undefined;
  messageId?: string | undefined;
  notificationType?: string | undefined;
  occurredAt?: string | undefined;
  queuedAt?: string | undefined;
  sentAt?: string | undefined;
  status: AdminDmDeliveryStatus;
};

export type AdminCommandUsageInput = {
  commandName: string;
  discordGuildId?: string | null | undefined;
  discordUserId?: string | undefined;
  durationMs?: number | undefined;
  errorCode?: string | undefined;
  occurredAt?: string | undefined;
  status: AdminCommandUsageStatus;
};

export type AdminGuildMessageInput = {
  channelId?: string | undefined;
  discordGuildId?: string | null | undefined;
  errorCode?: string | undefined;
  errorMessage?: string | undefined;
  messageId?: string | undefined;
  messageType: string;
  occurredAt?: string | undefined;
  status: AdminGuildMessageStatus;
};

export type AdminGuildRuntimeInput = {
  botPermissions?: string | null | undefined;
  discordGuildId: string;
  lastSeenAt?: string | undefined;
  linkedAt?: string | null | undefined;
  memberCount?: number | null | undefined;
  name?: string | null | undefined;
  unavailable?: boolean | undefined;
};

export type AdminAutomationRunInput = {
  automationType: AdminAutomationRunType;
  discordGuildId?: string | undefined;
  durationMs?: number | undefined;
  eventType?: string | undefined;
  failureCount?: number | undefined;
  occurredAt?: string | undefined;
  result?: unknown;
  runId?: number | undefined;
  skippedCount?: number | undefined;
  status: AdminAutomationRunStatus;
  successCount?: number | undefined;
};

export type AdminBotEventRecord = Required<
  Pick<AdminBotEventInput, "eventType" | "status">
> & {
  dataType: string | null;
  discordGuildId: string | null;
  discordUserId: string | null;
  errorCode: string | null;
  id: number;
  occurredAt: string;
  requestHost: string | null;
  requestId: string | null;
};

export type AdminDmDeliveryRecord = Required<
  Pick<AdminDmDeliveryInput, "discordUserId" | "status">
> & {
  errorCode: string | null;
  errorMessage: string | null;
  eventType: string | null;
  id: number;
  messageId: string | null;
  notificationType: string | null;
  occurredAt: string;
  queuedAt: string | null;
  sentAt: string | null;
};

export type AdminCommandUsageRecord = Required<
  Pick<AdminCommandUsageInput, "commandName" | "status">
> & {
  discordGuildId: string | null;
  discordUserId: string | null;
  durationMs: number | null;
  errorCode: string | null;
  id: number;
  occurredAt: string;
};

export type AdminGuildMessageRecord = Required<
  Pick<AdminGuildMessageInput, "messageType" | "status">
> & {
  channelId: string | null;
  discordGuildId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  id: number;
  messageId: string | null;
  occurredAt: string;
};

export type AdminAutomationRunRecord = {
  automationType: AdminAutomationRunType;
  discordGuildId: string | null;
  durationMs: number | null;
  eventType: string | null;
  failureCount: number;
  id: number;
  occurredAt: string;
  result: unknown;
  runId: number | null;
  skippedCount: number;
  status: AdminAutomationRunStatus;
  successCount: number;
};

export type AdminFailureRecord = {
  action: string;
  affectsHealth: boolean;
  details: unknown;
  discordGuildId: string | null;
  discordUserId: string | null;
  errorCode: string | null;
  eventType: string | null;
  id: number;
  message: string;
  occurredAt: string;
  runId: number | null;
  severity: string;
  source: string;
};

export type AdminGuildRecord = {
  botLogChannelId: string | null;
  botModeratorRoleId: string | null;
  botPermissions: string | null;
  cachedMemberCount: number | null;
  discordGuildId: string;
  lastError: string | null;
  lastFullRefreshAt: string | null;
  lastSeenAt: string | null;
  linked: boolean;
  linkedAt: string | null;
  memberCount: number | null;
  name: string | null;
  nextRefreshAfter: string | null;
  refreshStatus: string | null;
  runAnnouncementChannelId: string | null;
  syncDiscordNamesToFf14: boolean;
  unavailable: boolean;
  upcomingRaiderRoleId: string | null;
  updatedAt: string | null;
};

export type AdminGuildDashboardRecord = {
  guild: AdminGuildRecord;
  health: {
    issues: AdminGuildHealthIssue[];
    status: AdminGuildHealthStatus;
  };
  recent: {
    automationRuns: AdminAutomationRunRecord[];
    commandUsages: AdminCommandUsageRecord[];
    events: AdminBotEventRecord[];
    failures: AdminFailureRecord[];
    guildMessages: AdminGuildMessageRecord[];
  };
  totals: AdminGuildDashboardTotals;
  trends: {
    daily7d: AdminMetricBucket[];
  };
};

export type AdminGuildDashboardTotals = {
  automationFailures24h: number;
  automationRuns24h: number;
  commandFailures24h: number;
  commands24h: number;
  eventFailures24h: number;
  events24h: number;
  guildMessageFailures24h: number;
  guildMessagesSent24h: number;
  healthFailures24h: number;
  ignoredFailures24h: number;
};

export type AdminGuildHealthIssue = {
  key: string;
  occurredAt: string | null;
  reason: string;
  severity: "warn" | "error";
  status: AdminGuildHealthStatus;
};

export type AdminGuildHealthStatus = "healthy" | "degraded" | "unhealthy";

export type AdminQueueSummary = {
  jobsByStatus: Record<string, number>;
  oldestQueuedAt: string | null;
  recentFailedCount: number;
};

export type AdminTelemetrySummary = {
  automationRuns: {
    last24h: AdminStatusCounts;
    last1h: AdminStatusCounts;
  };
  commandUsages: {
    last24h: AdminStatusCounts;
    last1h: AdminStatusCounts;
  };
  dmDeliveries: {
    last24h: AdminStatusCounts;
    last1h: AdminStatusCounts;
  };
  events: {
    last24h: AdminStatusCounts;
    last1h: AdminStatusCounts;
  };
  guildMessages: {
    last24h: AdminStatusCounts;
    last1h: AdminStatusCounts;
  };
};

export type AdminStatusCounts = {
  byStatus: Record<string, number>;
  total: number;
};

export type AdminDashboardMetrics = {
  breakdowns: {
    automationStatuses24h: AdminLabeledCount[];
    commandNames24h: AdminLabeledCount[];
    dmStatuses24h: AdminLabeledCount[];
    eventTypes24h: AdminLabeledCount[];
    guildMessageStatuses24h: AdminLabeledCount[];
    notificationTypes24h: AdminLabeledCount[];
  };
  totals: {
    automationFailures24h: number;
    automationRuns24h: number;
    commandsFailed24h: number;
    commandsUsed24h: number;
    dmsFailed24h: number;
    dmsQueued24h: number;
    dmsSent24h: number;
    events24h: number;
    eventsFailed24h: number;
    failures24h: number;
    guildMessagesFailed24h: number;
    guildMessagesSent24h: number;
  };
  trends: {
    daily7d: AdminMetricBucket[];
    hourly24h: AdminMetricBucket[];
  };
};

export type AdminLabeledCount = {
  label: string;
  value: number;
};

export type AdminMetricBucket = {
  automationRuns: number;
  commands: number;
  dms: number;
  events: number;
  failures: number;
  guildMessages: number;
  label: string;
};
