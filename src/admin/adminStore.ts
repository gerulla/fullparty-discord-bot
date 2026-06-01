import type { DatabaseSync } from "node:sqlite";

import { openSqliteDatabase } from "../database/sqlite.js";

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

type CountRow = {
  count: number;
};

type StatusCountRow = {
  count: number;
  status: string;
};

type LabeledCountRow = {
  count: number;
  label: string | null;
};

type BucketCountRow = {
  bucket: string;
  count: number;
};

type BotEventRow = {
  data_type: string | null;
  discord_guild_id: string | null;
  discord_user_id: string | null;
  error_code: string | null;
  event_type: string;
  id: number;
  occurred_at: string;
  request_host: string | null;
  request_id: string | null;
  status: AdminBotEventStatus;
};

type DmDeliveryRow = {
  discord_user_id: string;
  error_code: string | null;
  error_message: string | null;
  event_type: string | null;
  id: number;
  message_id: string | null;
  notification_type: string | null;
  occurred_at: string;
  queued_at: string | null;
  sent_at: string | null;
  status: AdminDmDeliveryStatus;
};

type CommandUsageRow = {
  command_name: string;
  discord_guild_id: string | null;
  discord_user_id: string | null;
  duration_ms: number | null;
  error_code: string | null;
  id: number;
  occurred_at: string;
  status: AdminCommandUsageStatus;
};

type GuildMessageRow = {
  channel_id: string | null;
  discord_guild_id: string | null;
  error_code: string | null;
  error_message: string | null;
  id: number;
  message_id: string | null;
  message_type: string;
  occurred_at: string;
  status: AdminGuildMessageStatus;
};

type AutomationRunRow = {
  automation_type: AdminAutomationRunType;
  discord_guild_id: string | null;
  duration_ms: number | null;
  event_type: string | null;
  failure_count: number;
  id: number;
  occurred_at: string;
  result_json: string | null;
  run_id: number | null;
  skipped_count: number;
  status: AdminAutomationRunStatus;
  success_count: number;
};

type FailureRow = {
  action: string;
  affects_health: number;
  details_json: string | null;
  discord_guild_id: string | null;
  discord_user_id: string | null;
  error_code: string | null;
  event_type: string | null;
  id: number;
  message: string;
  occurred_at: string;
  run_id: number | null;
  severity: string;
  source: string;
};

type GuildRow = {
  bot_log_channel_id: string | null;
  bot_moderator_role_id: string | null;
  bot_permissions: string | null;
  cached_member_count: number | null;
  discord_guild_id: string;
  last_error: string | null;
  last_full_refresh_at: string | null;
  last_seen_at: string | null;
  linked_at: string | null;
  member_count: number | null;
  name: string | null;
  next_refresh_after: string | null;
  refresh_status: string | null;
  run_announcement_channel_id: string | null;
  sync_discord_names_to_ff14: number | null;
  unavailable: number | null;
  upcoming_raider_role_id: string | null;
  updated_at: string | null;
};

export class SqliteAdminStore implements AdminStore {
  private readonly database: DatabaseSync;

  public constructor(databasePath: string) {
    this.database = openSqliteDatabase(databasePath);
    this.initialize();
  }

  public recordBotEvent(input: AdminBotEventInput): Promise<void> {
    this.database
      .prepare(
        `
          INSERT INTO bot_events (
            data_type,
            discord_guild_id,
            discord_user_id,
            error_code,
            event_type,
            occurred_at,
            request_host,
            request_id,
            status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.dataType ?? null,
        input.discordGuildId ?? null,
        input.discordUserId ?? null,
        input.errorCode ?? null,
        input.eventType,
        input.occurredAt ?? new Date().toISOString(),
        input.requestHost ?? null,
        input.requestId ?? null,
        input.status,
      );

    return Promise.resolve();
  }

  public recordDmDelivery(input: AdminDmDeliveryInput): Promise<void> {
    this.database
      .prepare(
        `
          INSERT INTO dm_deliveries (
            discord_user_id,
            error_code,
            error_message,
            event_type,
            message_id,
            notification_type,
            occurred_at,
            queued_at,
            sent_at,
            status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.discordUserId,
        input.errorCode ?? null,
        input.errorMessage ?? null,
        input.eventType ?? null,
        input.messageId ?? null,
        input.notificationType ?? null,
        input.occurredAt ?? new Date().toISOString(),
        input.queuedAt ?? null,
        input.sentAt ?? null,
        input.status,
      );

    return Promise.resolve();
  }

  public recordCommandUsage(input: AdminCommandUsageInput): Promise<void> {
    this.database
      .prepare(
        `
          INSERT INTO command_usages (
            command_name,
            discord_guild_id,
            discord_user_id,
            duration_ms,
            error_code,
            occurred_at,
            status
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.commandName,
        input.discordGuildId ?? null,
        input.discordUserId ?? null,
        input.durationMs ?? null,
        input.errorCode ?? null,
        input.occurredAt ?? new Date().toISOString(),
        input.status,
      );

    return Promise.resolve();
  }

  public recordGuildMessage(input: AdminGuildMessageInput): Promise<void> {
    this.database
      .prepare(
        `
          INSERT INTO guild_messages (
            channel_id,
            discord_guild_id,
            error_code,
            error_message,
            message_id,
            message_type,
            occurred_at,
            status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.channelId ?? null,
        input.discordGuildId ?? null,
        input.errorCode ?? null,
        input.errorMessage ?? null,
        input.messageId ?? null,
        input.messageType,
        input.occurredAt ?? new Date().toISOString(),
        input.status,
      );

    return Promise.resolve();
  }

  public recordGuildRuntime(input: AdminGuildRuntimeInput): Promise<void> {
    const now = input.lastSeenAt ?? new Date().toISOString();

    this.database
      .prepare(
        `
          INSERT INTO guild_runtime (
            bot_permissions,
            discord_guild_id,
            last_seen_at,
            linked_at,
            member_count,
            name,
            unavailable
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(discord_guild_id) DO UPDATE SET
            bot_permissions = excluded.bot_permissions,
            last_seen_at = excluded.last_seen_at,
            linked_at = excluded.linked_at,
            member_count = excluded.member_count,
            name = excluded.name,
            unavailable = excluded.unavailable
        `,
      )
      .run(
        input.botPermissions ?? null,
        input.discordGuildId,
        now,
        input.linkedAt ?? null,
        input.memberCount ?? null,
        input.name ?? null,
        input.unavailable ? 1 : 0,
      );

    return Promise.resolve();
  }

  public recordAutomationRun(input: AdminAutomationRunInput): Promise<void> {
    this.database
      .prepare(
        `
          INSERT INTO automation_runs (
            automation_type,
            discord_guild_id,
            duration_ms,
            event_type,
            failure_count,
            occurred_at,
            result_json,
            run_id,
            skipped_count,
            status,
            success_count
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.automationType,
        input.discordGuildId ?? null,
        input.durationMs ?? null,
        input.eventType ?? null,
        input.failureCount ?? 0,
        input.occurredAt ?? new Date().toISOString(),
        input.result === undefined ? null : safeStringify(input.result),
        input.runId ?? null,
        input.skippedCount ?? 0,
        input.status,
        input.successCount ?? 0,
      );

    return Promise.resolve();
  }

  public getSummary(now: Date = new Date()): Promise<AdminTelemetrySummary> {
    return Promise.resolve({
      automationRuns: {
        last24h: this.countStatusesSince(
          "automation_runs",
          new Date(now.getTime() - 86_400_000),
        ),
        last1h: this.countStatusesSince(
          "automation_runs",
          new Date(now.getTime() - 3_600_000),
        ),
      },
      commandUsages: {
        last24h: this.countStatusesSince(
          "command_usages",
          new Date(now.getTime() - 86_400_000),
        ),
        last1h: this.countStatusesSince(
          "command_usages",
          new Date(now.getTime() - 3_600_000),
        ),
      },
      dmDeliveries: {
        last24h: this.countStatusesSince(
          "dm_deliveries",
          new Date(now.getTime() - 86_400_000),
        ),
        last1h: this.countStatusesSince(
          "dm_deliveries",
          new Date(now.getTime() - 3_600_000),
        ),
      },
      events: {
        last24h: this.countStatusesSince(
          "bot_events",
          new Date(now.getTime() - 86_400_000),
        ),
        last1h: this.countStatusesSince(
          "bot_events",
          new Date(now.getTime() - 3_600_000),
        ),
      },
      guildMessages: {
        last24h: this.countStatusesSince(
          "guild_messages",
          new Date(now.getTime() - 86_400_000),
        ),
        last1h: this.countStatusesSince(
          "guild_messages",
          new Date(now.getTime() - 3_600_000),
        ),
      },
    });
  }

  public getEvents(limit = 100): Promise<AdminBotEventRecord[]> {
    const rows = this.database
      .prepare(
        `
          SELECT *
          FROM bot_events
          ORDER BY occurred_at DESC, id DESC
          LIMIT ?
        `,
      )
      .all(normalizeLimit(limit)) as BotEventRow[];

    return Promise.resolve(rows.map(rowToBotEvent));
  }

  public getDmDeliveries(limit = 100): Promise<AdminDmDeliveryRecord[]> {
    const rows = this.database
      .prepare(
        `
          SELECT *
          FROM dm_deliveries
          ORDER BY occurred_at DESC, id DESC
          LIMIT ?
        `,
      )
      .all(normalizeLimit(limit)) as DmDeliveryRow[];

    return Promise.resolve(rows.map(rowToDmDelivery));
  }

  public getCommandUsages(limit = 100): Promise<AdminCommandUsageRecord[]> {
    const rows = this.database
      .prepare(
        `
          SELECT *
          FROM command_usages
          ORDER BY occurred_at DESC, id DESC
          LIMIT ?
        `,
      )
      .all(normalizeLimit(limit)) as CommandUsageRow[];

    return Promise.resolve(rows.map(rowToCommandUsage));
  }

  public getGuildMessages(limit = 100): Promise<AdminGuildMessageRecord[]> {
    const rows = this.database
      .prepare(
        `
          SELECT *
          FROM guild_messages
          ORDER BY occurred_at DESC, id DESC
          LIMIT ?
        `,
      )
      .all(normalizeLimit(limit)) as GuildMessageRow[];

    return Promise.resolve(rows.map(rowToGuildMessage));
  }

  public getAutomationRuns(limit = 100): Promise<AdminAutomationRunRecord[]> {
    const rows = this.database
      .prepare(
        `
          SELECT *
          FROM automation_runs
          ORDER BY occurred_at DESC, id DESC
          LIMIT ?
        `,
      )
      .all(normalizeLimit(limit)) as AutomationRunRow[];

    return Promise.resolve(rows.map(rowToAutomationRun));
  }

  public getDashboardMetrics(now: Date = new Date()): Promise<AdminDashboardMetrics> {
    const since24h = new Date(now.getTime() - 86_400_000).toISOString();
    const dailyStart = startOfUtcDay(new Date(now.getTime() - 6 * 86_400_000));
    const since7d = dailyStart.toISOString();

    return Promise.resolve({
      breakdowns: {
        automationStatuses24h: this.countLabelsSince(
          "automation_runs",
          "status",
          since24h,
        ),
        commandNames24h: this.countLabelsSince(
          "command_usages",
          "command_name",
          since24h,
        ),
        dmStatuses24h: this.countLabelsSince("dm_deliveries", "status", since24h),
        eventTypes24h: this.countLabelsSince("bot_events", "event_type", since24h),
        guildMessageStatuses24h: this.countLabelsSince(
          "guild_messages",
          "status",
          since24h,
        ),
        notificationTypes24h: this.countLabelsSince(
          "dm_deliveries",
          "notification_type",
          since24h,
        ),
      },
      totals: {
        automationFailures24h: this.countSince("automation_runs", since24h, {
          status: ["failed", "partial"],
        }),
        automationRuns24h: this.countSince("automation_runs", since24h),
        commandsFailed24h: this.countSince("command_usages", since24h, {
          status: "failed",
        }),
        commandsUsed24h: this.countSince("command_usages", since24h),
        dmsFailed24h: this.countSince("dm_deliveries", since24h, {
          status: "failed",
        }),
        dmsQueued24h: this.countSince("dm_deliveries", since24h, {
          status: "queued",
        }),
        dmsSent24h: this.countSince("dm_deliveries", since24h, {
          status: "sent",
        }),
        events24h: this.countSince("bot_events", since24h),
        eventsFailed24h: this.countSince("bot_events", since24h, {
          status: "failed",
        }),
        failures24h: this.countSince("bot_failures", since24h),
        guildMessagesFailed24h: this.countSince("guild_messages", since24h, {
          status: "failed",
        }),
        guildMessagesSent24h: this.countSince("guild_messages", since24h, {
          status: "sent",
        }),
      },
      trends: {
        daily7d: this.createMetricBuckets({
          format: "%Y-%m-%d",
          intervalMs: 86_400_000,
          since: since7d,
          start: dailyStart,
          steps: 7,
        }),
        hourly24h: this.createMetricBuckets({
          format: "%Y-%m-%dT%H:00:00Z",
          intervalMs: 3_600_000,
          since: since24h,
          start: startOfUtcHour(new Date(now.getTime() - 23 * 3_600_000)),
          steps: 24,
        }),
      },
    });
  }

  public getFailures(limit = 100): Promise<AdminFailureRecord[]> {
    const rows = this.database
      .prepare(
        `
          SELECT *
          FROM bot_failures
          ORDER BY occurred_at DESC, id DESC
          LIMIT ?
        `,
      )
      .all(normalizeLimit(limit)) as FailureRow[];

    return Promise.resolve(rows.map(rowToFailure));
  }

  public async getGuildDashboards(
    now: Date = new Date(),
  ): Promise<AdminGuildDashboardRecord[]> {
    const guilds = await this.getGuilds();

    return guilds.map((guild) => this.createGuildDashboard(guild, now));
  }

  public getGuilds(): Promise<AdminGuildRecord[]> {
    const rows = this.database
      .prepare(
        `
          WITH guild_ids AS (
            SELECT discord_guild_id FROM guild_runtime
            UNION
            SELECT guild_id AS discord_guild_id FROM guild_settings
            UNION
            SELECT discord_guild_id FROM guild_member_cache_status
          )
          SELECT
            ids.discord_guild_id,
            runtime.name,
            runtime.member_count,
            runtime.bot_permissions,
            runtime.last_seen_at,
            runtime.unavailable,
            settings.bot_log_channel_id,
            settings.bot_moderator_role_id,
            settings.linked_at,
            settings.run_announcement_channel_id,
            settings.sync_discord_names_to_ff14,
            settings.upcoming_raider_role_id,
            settings.updated_at,
            cache.cached_member_count,
            cache.last_error,
            cache.last_full_refresh_at,
            cache.next_refresh_after,
            cache.refresh_status
          FROM guild_ids ids
          LEFT JOIN guild_runtime runtime
            ON runtime.discord_guild_id = ids.discord_guild_id
          LEFT JOIN guild_settings settings
            ON settings.guild_id = ids.discord_guild_id
          LEFT JOIN guild_member_cache_status cache
            ON cache.discord_guild_id = ids.discord_guild_id
          ORDER BY COALESCE(runtime.name, ids.discord_guild_id) ASC
        `,
      )
      .all() as GuildRow[];

    return Promise.resolve(rows.map(rowToGuild));
  }

  public getQueueSummary(): Promise<AdminQueueSummary> {
    const rows = this.database
      .prepare(
        `
          SELECT status, COUNT(*) AS count
          FROM guild_run_reminder_jobs
          GROUP BY status
        `,
      )
      .all() as StatusCountRow[];
    const oldestQueued = this.database
      .prepare(
        `
          SELECT MIN(created_at) AS created_at
          FROM guild_run_reminder_jobs
          WHERE status = 'queued'
        `,
      )
      .get() as { created_at: string | null };
    const failedSince = new Date(Date.now() - 3_600_000).toISOString();
    const failed = this.database
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM guild_run_reminder_jobs
          WHERE status = 'failed'
            AND completed_at >= ?
        `,
      )
      .get(failedSince) as CountRow;

    return Promise.resolve({
      jobsByStatus: Object.fromEntries(rows.map((row) => [row.status, row.count])),
      oldestQueuedAt: oldestQueued.created_at,
      recentFailedCount: failed.count,
    });
  }

  public close(): void {
    this.database.close();
  }

  private initialize(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS bot_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        occurred_at TEXT NOT NULL,
        event_type TEXT NOT NULL,
        data_type TEXT,
        request_host TEXT,
        request_id TEXT,
        discord_guild_id TEXT,
        discord_user_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('accepted', 'failed')),
        error_code TEXT
      )
    `);
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS bot_events_occurred_at_idx
      ON bot_events (occurred_at)
    `);
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS bot_events_status_occurred_at_idx
      ON bot_events (status, occurred_at)
    `);
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS bot_events_guild_occurred_at_idx
      ON bot_events (discord_guild_id, occurred_at)
    `);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS dm_deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        occurred_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'failed')),
        discord_user_id TEXT NOT NULL,
        event_type TEXT,
        notification_type TEXT,
        queued_at TEXT,
        sent_at TEXT,
        message_id TEXT,
        error_code TEXT,
        error_message TEXT
      )
    `);
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS dm_deliveries_occurred_at_idx
      ON dm_deliveries (occurred_at)
    `);
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS dm_deliveries_user_occurred_at_idx
      ON dm_deliveries (discord_user_id, occurred_at)
    `);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS command_usages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        occurred_at TEXT NOT NULL,
        command_name TEXT NOT NULL,
        discord_guild_id TEXT,
        discord_user_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
        duration_ms INTEGER,
        error_code TEXT
      )
    `);
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS command_usages_occurred_at_idx
      ON command_usages (occurred_at)
    `);
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS command_usages_status_occurred_at_idx
      ON command_usages (status, occurred_at)
    `);
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS command_usages_guild_occurred_at_idx
      ON command_usages (discord_guild_id, occurred_at)
    `);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS guild_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        occurred_at TEXT NOT NULL,
        message_type TEXT NOT NULL,
        discord_guild_id TEXT,
        channel_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
        message_id TEXT,
        error_code TEXT,
        error_message TEXT
      )
    `);
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS guild_messages_occurred_at_idx
      ON guild_messages (occurred_at)
    `);
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS guild_messages_status_occurred_at_idx
      ON guild_messages (status, occurred_at)
    `);
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS guild_messages_guild_occurred_at_idx
      ON guild_messages (discord_guild_id, occurred_at)
    `);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS guild_runtime (
        discord_guild_id TEXT PRIMARY KEY,
        name TEXT,
        member_count INTEGER,
        linked_at TEXT,
        bot_permissions TEXT,
        last_seen_at TEXT NOT NULL,
        unavailable INTEGER NOT NULL DEFAULT 0 CHECK (unavailable IN (0, 1))
      )
    `);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS automation_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        occurred_at TEXT NOT NULL,
        automation_type TEXT NOT NULL
          CHECK (automation_type IN ('role_assignment', 'nickname_sync', 'role_cleanup')),
        event_type TEXT,
        discord_guild_id TEXT,
        run_id INTEGER,
        status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'partial', 'skipped')),
        success_count INTEGER NOT NULL DEFAULT 0,
        failure_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER,
        result_json TEXT
      )
    `);
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS automation_runs_occurred_at_idx
      ON automation_runs (occurred_at)
    `);
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS automation_runs_guild_run_idx
      ON automation_runs (discord_guild_id, run_id, occurred_at)
    `);
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS automation_runs_guild_occurred_at_idx
      ON automation_runs (discord_guild_id, occurred_at)
    `);
    initializeReadTables(this.database);
  }

  private countStatusesSince(tableName: string, since: Date): AdminStatusCounts {
    const rows = this.database
      .prepare(
        `
          SELECT status, COUNT(*) AS count
          FROM ${tableName}
          WHERE occurred_at >= ?
          GROUP BY status
        `,
      )
      .all(since.toISOString()) as StatusCountRow[];
    const byStatus = Object.fromEntries(rows.map((row) => [row.status, row.count]));

    return {
      byStatus,
      total: rows.reduce((sum, row) => sum + row.count, 0),
    };
  }

  private countSince(
    tableName: string,
    since: string,
    filters: { status?: string | string[] } = {},
  ): number {
    const { clause, parameters } = createStatusFilter(filters.status);
    const row = this.database
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM ${tableName}
          WHERE occurred_at >= ?
          ${clause}
        `,
      )
      .get(since, ...parameters) as CountRow;

    return row.count;
  }

  private countGuildSince(
    tableName: string,
    discordGuildId: string,
    since: string,
    filters: {
      affectsHealth?: boolean | undefined;
      status?: string | string[] | undefined;
    } = {},
  ): number {
    const { clause, parameters } = createTelemetryFilter({
      ...filters,
      discordGuildId,
    });
    const row = this.database
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM ${tableName}
          WHERE occurred_at >= ?
          ${clause}
        `,
      )
      .get(since, ...parameters) as CountRow;

    return row.count;
  }

  private countGuildAutomationFailuresSince(
    discordGuildId: string,
    since: string,
  ): number {
    const row = this.database
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM automation_runs
          WHERE occurred_at >= ?
            AND discord_guild_id = ?
            AND (
              status IN ('failed', 'partial')
              OR failure_count > 0
            )
        `,
      )
      .get(since, discordGuildId) as CountRow;

    return row.count;
  }

  private createGuildDashboard(
    guild: AdminGuildRecord,
    now: Date,
  ): AdminGuildDashboardRecord {
    const since24h = new Date(now.getTime() - 86_400_000).toISOString();
    const dailyStart = startOfUtcDay(new Date(now.getTime() - 6 * 86_400_000));
    const since7d = dailyStart.toISOString();
    const totals: AdminGuildDashboardTotals = {
      automationFailures24h: this.countGuildAutomationFailuresSince(
        guild.discordGuildId,
        since24h,
      ),
      automationRuns24h: this.countGuildSince(
        "automation_runs",
        guild.discordGuildId,
        since24h,
      ),
      commandFailures24h: this.countGuildSince(
        "command_usages",
        guild.discordGuildId,
        since24h,
        { status: "failed" },
      ),
      commands24h: this.countGuildSince("command_usages", guild.discordGuildId, since24h),
      eventFailures24h: this.countGuildSince(
        "bot_events",
        guild.discordGuildId,
        since24h,
        { status: "failed" },
      ),
      events24h: this.countGuildSince("bot_events", guild.discordGuildId, since24h),
      guildMessageFailures24h: this.countGuildSince(
        "guild_messages",
        guild.discordGuildId,
        since24h,
        { status: "failed" },
      ),
      guildMessagesSent24h: this.countGuildSince(
        "guild_messages",
        guild.discordGuildId,
        since24h,
        { status: "sent" },
      ),
      healthFailures24h: this.countGuildSince(
        "bot_failures",
        guild.discordGuildId,
        since24h,
        { affectsHealth: true },
      ),
      ignoredFailures24h: this.countGuildSince(
        "bot_failures",
        guild.discordGuildId,
        since24h,
        { affectsHealth: false },
      ),
    };
    const recent = {
      automationRuns: this.getRecentAutomationRunsForGuild(guild.discordGuildId),
      commandUsages: this.getRecentCommandUsagesForGuild(guild.discordGuildId),
      events: this.getRecentEventsForGuild(guild.discordGuildId),
      failures: this.getRecentFailuresForGuild(guild.discordGuildId),
      guildMessages: this.getRecentGuildMessagesForGuild(guild.discordGuildId),
    };
    const health = createGuildHealth(guild, totals, recent.failures);

    return {
      guild,
      health,
      recent,
      totals,
      trends: {
        daily7d: this.createGuildMetricBuckets({
          discordGuildId: guild.discordGuildId,
          format: "%Y-%m-%d",
          intervalMs: 86_400_000,
          since: since7d,
          start: dailyStart,
          steps: 7,
        }),
      },
    };
  }

  private getRecentEventsForGuild(
    discordGuildId: string,
    limit = 8,
  ): AdminBotEventRecord[] {
    const rows = this.database
      .prepare(
        `
          SELECT *
          FROM bot_events
          WHERE discord_guild_id = ?
          ORDER BY occurred_at DESC, id DESC
          LIMIT ?
        `,
      )
      .all(discordGuildId, normalizeLimit(limit)) as BotEventRow[];

    return rows.map(rowToBotEvent);
  }

  private getRecentCommandUsagesForGuild(
    discordGuildId: string,
    limit = 8,
  ): AdminCommandUsageRecord[] {
    const rows = this.database
      .prepare(
        `
          SELECT *
          FROM command_usages
          WHERE discord_guild_id = ?
          ORDER BY occurred_at DESC, id DESC
          LIMIT ?
        `,
      )
      .all(discordGuildId, normalizeLimit(limit)) as CommandUsageRow[];

    return rows.map(rowToCommandUsage);
  }

  private getRecentGuildMessagesForGuild(
    discordGuildId: string,
    limit = 8,
  ): AdminGuildMessageRecord[] {
    const rows = this.database
      .prepare(
        `
          SELECT *
          FROM guild_messages
          WHERE discord_guild_id = ?
          ORDER BY occurred_at DESC, id DESC
          LIMIT ?
        `,
      )
      .all(discordGuildId, normalizeLimit(limit)) as GuildMessageRow[];

    return rows.map(rowToGuildMessage);
  }

  private getRecentAutomationRunsForGuild(
    discordGuildId: string,
    limit = 8,
  ): AdminAutomationRunRecord[] {
    const rows = this.database
      .prepare(
        `
          SELECT *
          FROM automation_runs
          WHERE discord_guild_id = ?
          ORDER BY occurred_at DESC, id DESC
          LIMIT ?
        `,
      )
      .all(discordGuildId, normalizeLimit(limit)) as AutomationRunRow[];

    return rows.map(rowToAutomationRun);
  }

  private getRecentFailuresForGuild(
    discordGuildId: string,
    limit = 8,
  ): AdminFailureRecord[] {
    const rows = this.database
      .prepare(
        `
          SELECT *
          FROM bot_failures
          WHERE discord_guild_id = ?
          ORDER BY occurred_at DESC, id DESC
          LIMIT ?
        `,
      )
      .all(discordGuildId, normalizeLimit(limit)) as FailureRow[];

    return rows.map(rowToFailure);
  }

  private countLabelsSince(
    tableName: string,
    columnName: string,
    since: string,
  ): AdminLabeledCount[] {
    const rows = this.database
      .prepare(
        `
          SELECT COALESCE(NULLIF(${columnName}, ''), 'unknown') AS label,
                 COUNT(*) AS count
          FROM ${tableName}
          WHERE occurred_at >= ?
          GROUP BY label
          ORDER BY count DESC, label ASC
          LIMIT 8
        `,
      )
      .all(since) as LabeledCountRow[];

    return rows.map((row) => ({
      label: row.label ?? "unknown",
      value: row.count,
    }));
  }

  private createMetricBuckets(options: {
    format: string;
    intervalMs: number;
    since: string;
    start: Date;
    steps: number;
  }): AdminMetricBucket[] {
    const eventCounts = this.getBucketCounts("bot_events", options.format, options.since);
    const dmCounts = this.getBucketCounts(
      "dm_deliveries",
      options.format,
      options.since,
      {
        status: "sent",
      },
    );
    const guildMessageCounts = this.getBucketCounts(
      "guild_messages",
      options.format,
      options.since,
      { status: "sent" },
    );
    const commandCounts = this.getBucketCounts(
      "command_usages",
      options.format,
      options.since,
    );
    const failureCounts = this.getBucketCounts(
      "bot_failures",
      options.format,
      options.since,
    );
    const automationCounts = this.getBucketCounts(
      "automation_runs",
      options.format,
      options.since,
    );

    return Array.from({ length: options.steps }, (_, index) => {
      const label = formatBucketLabel(
        new Date(options.start.getTime() + index * options.intervalMs),
        options.intervalMs,
      );

      return {
        automationRuns: automationCounts.get(label) ?? 0,
        commands: commandCounts.get(label) ?? 0,
        dms: dmCounts.get(label) ?? 0,
        events: eventCounts.get(label) ?? 0,
        failures: failureCounts.get(label) ?? 0,
        guildMessages: guildMessageCounts.get(label) ?? 0,
        label,
      };
    });
  }

  private createGuildMetricBuckets(options: {
    discordGuildId: string;
    format: string;
    intervalMs: number;
    since: string;
    start: Date;
    steps: number;
  }): AdminMetricBucket[] {
    const eventCounts = this.getBucketCounts(
      "bot_events",
      options.format,
      options.since,
      {
        discordGuildId: options.discordGuildId,
      },
    );
    const guildMessageCounts = this.getBucketCounts(
      "guild_messages",
      options.format,
      options.since,
      {
        discordGuildId: options.discordGuildId,
        status: "sent",
      },
    );
    const commandCounts = this.getBucketCounts(
      "command_usages",
      options.format,
      options.since,
      {
        discordGuildId: options.discordGuildId,
      },
    );
    const failureCounts = this.getBucketCounts(
      "bot_failures",
      options.format,
      options.since,
      {
        affectsHealth: true,
        discordGuildId: options.discordGuildId,
      },
    );
    const automationCounts = this.getBucketCounts(
      "automation_runs",
      options.format,
      options.since,
      {
        discordGuildId: options.discordGuildId,
      },
    );

    return Array.from({ length: options.steps }, (_, index) => {
      const label = formatBucketLabel(
        new Date(options.start.getTime() + index * options.intervalMs),
        options.intervalMs,
      );

      return {
        automationRuns: automationCounts.get(label) ?? 0,
        commands: commandCounts.get(label) ?? 0,
        dms: 0,
        events: eventCounts.get(label) ?? 0,
        failures: failureCounts.get(label) ?? 0,
        guildMessages: guildMessageCounts.get(label) ?? 0,
        label,
      };
    });
  }

  private getBucketCounts(
    tableName: string,
    format: string,
    since: string,
    filters: {
      affectsHealth?: boolean | undefined;
      discordGuildId?: string | undefined;
      status?: string | string[] | undefined;
    } = {},
  ): Map<string, number> {
    const { clause, parameters } = createTelemetryFilter(filters);
    const rows = this.database
      .prepare(
        `
          SELECT strftime(?, occurred_at) AS bucket,
                 COUNT(*) AS count
          FROM ${tableName}
          WHERE occurred_at >= ?
          ${clause}
          GROUP BY bucket
        `,
      )
      .all(format, since, ...parameters) as BucketCountRow[];

    return new Map(rows.map((row) => [row.bucket, row.count]));
  }
}

function initializeReadTables(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS bot_failures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      occurred_at TEXT NOT NULL,
      affects_health INTEGER NOT NULL DEFAULT 1 CHECK (affects_health IN (0, 1)),
      severity TEXT NOT NULL CHECK (severity IN ('warn', 'error')),
      source TEXT NOT NULL,
      action TEXT NOT NULL,
      message TEXT NOT NULL,
      error_code TEXT,
      event_type TEXT,
      discord_guild_id TEXT,
      discord_user_id TEXT,
      run_id INTEGER,
      details_json TEXT
    )
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS bot_failures_guild_occurred_at_idx
    ON bot_failures (discord_guild_id, occurred_at)
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      bot_log_channel_id TEXT,
      bot_moderator_role_id TEXT,
      linked_at TEXT,
      run_announcement_channel_id TEXT,
      upcoming_raider_role_id TEXT,
      sync_discord_names_to_ff14 INTEGER NOT NULL DEFAULT 0
        CHECK (sync_discord_names_to_ff14 IN (0, 1)),
      updated_at TEXT
    )
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS guild_member_cache_status (
      discord_guild_id TEXT PRIMARY KEY,
      member_count INTEGER,
      cached_member_count INTEGER NOT NULL DEFAULT 0,
      last_full_refresh_at TEXT,
      next_refresh_after TEXT,
      refresh_status TEXT NOT NULL DEFAULT 'missing'
        CHECK (refresh_status IN ('missing', 'refreshing', 'fresh', 'failed')),
      last_error TEXT,
      updated_at TEXT NOT NULL DEFAULT ''
    )
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS guild_run_reminder_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dedupe_key TEXT NOT NULL UNIQUE,
      discord_guild_id TEXT NOT NULL,
      job_kind TEXT NOT NULL DEFAULT 'run_reminder'
        CHECK (job_kind IN ('run_reminder', 'run_completed')),
      run_id INTEGER NOT NULL,
      reminder_type TEXT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
      payload_json TEXT NOT NULL,
      result_json TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      available_at TEXT NOT NULL,
      locked_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}

function createGuildHealth(
  guild: AdminGuildRecord,
  totals: AdminGuildDashboardTotals,
  recentFailures: AdminFailureRecord[],
): AdminGuildDashboardRecord["health"] {
  const issues: AdminGuildHealthIssue[] = [];
  const addIssue = (issue: AdminGuildHealthIssue): void => {
    issues.push(issue);
  };

  if (guild.unavailable) {
    addIssue({
      key: "guild_unavailable",
      occurredAt: guild.lastSeenAt,
      reason: "Discord currently reports this guild as unavailable.",
      severity: "error",
      status: "unhealthy",
    });
  }

  if (!guild.linked) {
    addIssue({
      key: "guild_not_linked",
      occurredAt: guild.lastSeenAt,
      reason:
        "This guild is not linked to a FullParty group, so guild automation will not run.",
      severity: "warn",
      status: "degraded",
    });
  }

  if (guild.linked && !guild.botLogChannelId) {
    addIssue({
      key: "bot_log_channel_missing",
      occurredAt: guild.updatedAt,
      reason:
        "Bot Log channel is not configured, so operational messages may be skipped.",
      severity: "warn",
      status: "degraded",
    });
  }

  if (guild.linked && !guild.runAnnouncementChannelId) {
    addIssue({
      key: "member_facing_channel_missing",
      occurredAt: guild.updatedAt,
      reason: "Member-Facing Channel is not configured.",
      severity: "warn",
      status: "degraded",
    });
  }

  if (guild.linked && !guild.upcomingRaiderRoleId) {
    addIssue({
      key: "template_role_missing",
      occurredAt: guild.updatedAt,
      reason: "Template Role is not configured, so run role creation cannot work.",
      severity: "warn",
      status: "degraded",
    });
  }

  if (guild.linked && guild.refreshStatus === "failed") {
    addIssue({
      key: "member_cache_failed",
      occurredAt: guild.updatedAt,
      reason: guild.lastError
        ? `Guild member cache refresh failed: ${guild.lastError}`
        : "Guild member cache refresh failed.",
      severity: "warn",
      status: "degraded",
    });
  } else if (
    guild.linked &&
    guild.refreshStatus !== null &&
    guild.refreshStatus !== "fresh"
  ) {
    addIssue({
      key: "member_cache_not_fresh",
      occurredAt: guild.updatedAt,
      reason: `Guild member cache is ${guild.refreshStatus}.`,
      severity: "warn",
      status: "degraded",
    });
  }

  if (totals.healthFailures24h > 0) {
    const recentHealthFailure = recentFailures.find((failure) => failure.affectsHealth);
    const hasError = recentFailures.some(
      (failure) => failure.affectsHealth && failure.severity === "error",
    );

    addIssue({
      key: "health_failures_24h",
      occurredAt: recentHealthFailure?.occurredAt ?? null,
      reason: `${String(totals.healthFailures24h)} health-impacting failure(s) were recorded in the last 24h.`,
      severity: hasError ? "error" : "warn",
      status: hasError ? "unhealthy" : "degraded",
    });
  }

  if (totals.automationFailures24h > 0) {
    addIssue({
      key: "automation_failures_24h",
      occurredAt: null,
      reason: `${String(totals.automationFailures24h)} guild automation run(s) were partial or failed in the last 24h.`,
      severity: "warn",
      status: "degraded",
    });
  }

  if (totals.guildMessageFailures24h > 0) {
    addIssue({
      key: "guild_message_failures_24h",
      occurredAt: null,
      reason: `${String(totals.guildMessageFailures24h)} guild message(s) failed to send in the last 24h.`,
      severity: "warn",
      status: "degraded",
    });
  }

  const status = issues.some((issue) => issue.status === "unhealthy")
    ? "unhealthy"
    : issues.length > 0
      ? "degraded"
      : "healthy";

  return {
    issues,
    status,
  };
}

function rowToBotEvent(row: BotEventRow): AdminBotEventRecord {
  return {
    dataType: row.data_type,
    discordGuildId: row.discord_guild_id,
    discordUserId: row.discord_user_id,
    errorCode: row.error_code,
    eventType: row.event_type,
    id: row.id,
    occurredAt: row.occurred_at,
    requestHost: row.request_host,
    requestId: row.request_id,
    status: row.status,
  };
}

function rowToDmDelivery(row: DmDeliveryRow): AdminDmDeliveryRecord {
  return {
    discordUserId: row.discord_user_id,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    eventType: row.event_type,
    id: row.id,
    messageId: row.message_id,
    notificationType: row.notification_type,
    occurredAt: row.occurred_at,
    queuedAt: row.queued_at,
    sentAt: row.sent_at,
    status: row.status,
  };
}

function rowToCommandUsage(row: CommandUsageRow): AdminCommandUsageRecord {
  return {
    commandName: row.command_name,
    discordGuildId: row.discord_guild_id,
    discordUserId: row.discord_user_id,
    durationMs: row.duration_ms,
    errorCode: row.error_code,
    id: row.id,
    occurredAt: row.occurred_at,
    status: row.status,
  };
}

function rowToGuildMessage(row: GuildMessageRow): AdminGuildMessageRecord {
  return {
    channelId: row.channel_id,
    discordGuildId: row.discord_guild_id,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    id: row.id,
    messageId: row.message_id,
    messageType: row.message_type,
    occurredAt: row.occurred_at,
    status: row.status,
  };
}

function rowToAutomationRun(row: AutomationRunRow): AdminAutomationRunRecord {
  return {
    automationType: row.automation_type,
    discordGuildId: row.discord_guild_id,
    durationMs: row.duration_ms,
    eventType: row.event_type,
    failureCount: row.failure_count,
    id: row.id,
    occurredAt: row.occurred_at,
    result: parseJsonField(row.result_json),
    runId: row.run_id,
    skippedCount: row.skipped_count,
    status: row.status,
    successCount: row.success_count,
  };
}

function rowToFailure(row: FailureRow): AdminFailureRecord {
  return {
    action: row.action,
    affectsHealth: row.affects_health === 1,
    details: parseJsonField(row.details_json),
    discordGuildId: row.discord_guild_id,
    discordUserId: row.discord_user_id,
    errorCode: row.error_code,
    eventType: row.event_type,
    id: row.id,
    message: row.message,
    occurredAt: row.occurred_at,
    runId: row.run_id,
    severity: row.severity,
    source: row.source,
  };
}

function rowToGuild(row: GuildRow): AdminGuildRecord {
  return {
    botLogChannelId: row.bot_log_channel_id,
    botModeratorRoleId: row.bot_moderator_role_id,
    botPermissions: row.bot_permissions,
    cachedMemberCount: row.cached_member_count,
    discordGuildId: row.discord_guild_id,
    lastError: row.last_error,
    lastFullRefreshAt: row.last_full_refresh_at,
    lastSeenAt: row.last_seen_at,
    linked: Boolean(row.linked_at),
    linkedAt: row.linked_at,
    memberCount: row.member_count,
    name: row.name,
    nextRefreshAfter: row.next_refresh_after,
    refreshStatus: row.refresh_status,
    runAnnouncementChannelId: row.run_announcement_channel_id,
    syncDiscordNamesToFf14: row.sync_discord_names_to_ff14 === 1,
    unavailable: row.unavailable === 1,
    upcomingRaiderRoleId: row.upcoming_raider_role_id,
    updatedAt: row.updated_at,
  };
}

function normalizeLimit(limit: number): number {
  return Math.max(1, Math.min(500, Math.floor(limit)));
}

function createStatusFilter(status: string | string[] | undefined): {
  clause: string;
  parameters: string[];
} {
  if (!status) {
    return {
      clause: "",
      parameters: [],
    };
  }

  if (Array.isArray(status)) {
    return {
      clause: `AND status IN (${status.map(() => "?").join(", ")})`,
      parameters: status,
    };
  }

  return {
    clause: "AND status = ?",
    parameters: [status],
  };
}

function createTelemetryFilter(filters: {
  affectsHealth?: boolean | undefined;
  discordGuildId?: string | undefined;
  status?: string | string[] | undefined;
}): {
  clause: string;
  parameters: (number | string)[];
} {
  const clauses: string[] = [];
  const parameters: (number | string)[] = [];

  if (filters.discordGuildId) {
    clauses.push("discord_guild_id = ?");
    parameters.push(filters.discordGuildId);
  }

  if (filters.status) {
    if (Array.isArray(filters.status)) {
      clauses.push(`status IN (${filters.status.map(() => "?").join(", ")})`);
      parameters.push(...filters.status);
    } else {
      clauses.push("status = ?");
      parameters.push(filters.status);
    }
  }

  if (filters.affectsHealth !== undefined) {
    clauses.push("affects_health = ?");
    parameters.push(filters.affectsHealth ? 1 : 0);
  }

  return {
    clause: clauses.length > 0 ? `AND ${clauses.join(" AND ")}` : "",
    parameters,
  };
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcHour(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours(),
    ),
  );
}

function formatBucketLabel(date: Date, intervalMs: number): string {
  return intervalMs >= 86_400_000
    ? date.toISOString().slice(0, 10)
    : `${date.toISOString().slice(0, 13)}:00:00Z`;
}

function parseJsonField(value: string | null): unknown {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({
      unserializable: String(value),
    });
  }
}
