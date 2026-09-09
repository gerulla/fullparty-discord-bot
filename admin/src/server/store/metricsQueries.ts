import type { DatabaseSync } from "node:sqlite";
import type {
  AdminDashboardMetrics,
  AdminLabeledCount,
  AdminMetricBucket,
  AdminStatusCounts,
  AdminTelemetrySummary,
} from "../../shared/telemetry.js";
import {
  createStatusFilter,
  createTelemetryFilter,
  formatBucketLabel,
  startOfUtcDay,
  startOfUtcHour,
} from "./queryHelpers.js";
import type {
  BucketCountRow,
  CountRow,
  LabeledCountRow,
  StatusCountRow,
} from "./rows.js";

export class AdminMetricsQueries {
  public constructor(private readonly database: DatabaseSync) {}
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

  public getBucketCounts(
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
