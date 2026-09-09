import type { DatabaseSync } from "node:sqlite";
import type {
  AdminAutomationRunRecord,
  AdminBotEventRecord,
  AdminCommandUsageRecord,
  AdminFailureRecord,
  AdminGuildDashboardRecord,
  AdminGuildDashboardTotals,
  AdminGuildMessageRecord,
  AdminGuildRecord,
  AdminMetricBucket,
} from "../../shared/telemetry.js";
import { createGuildHealth } from "./guildHealth.js";
import { AdminMetricsQueries } from "./metricsQueries.js";
import {
  createTelemetryFilter,
  formatBucketLabel,
  normalizeLimit,
  startOfUtcDay,
} from "./queryHelpers.js";
import { AdminRecordQueries } from "./recordQueries.js";
import type {
  AutomationRunRow,
  BotEventRow,
  CommandUsageRow,
  CountRow,
  FailureRow,
  GuildMessageRow,
} from "./rows.js";
import {
  rowToAutomationRun,
  rowToBotEvent,
  rowToCommandUsage,
  rowToFailure,
  rowToGuildMessage,
} from "./rows.js";

export class AdminGuildQueries {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly records: AdminRecordQueries,
    private readonly metrics: AdminMetricsQueries,
  ) {}
  public async getGuildDashboards(
    now: Date = new Date(),
  ): Promise<AdminGuildDashboardRecord[]> {
    const guilds = await this.records.getGuilds();

    return guilds.map((guild) => this.createGuildDashboard(guild, now));
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

  private createGuildMetricBuckets(options: {
    discordGuildId: string;
    format: string;
    intervalMs: number;
    since: string;
    start: Date;
    steps: number;
  }): AdminMetricBucket[] {
    const eventCounts = this.metrics.getBucketCounts(
      "bot_events",
      options.format,
      options.since,
      {
        discordGuildId: options.discordGuildId,
      },
    );
    const guildMessageCounts = this.metrics.getBucketCounts(
      "guild_messages",
      options.format,
      options.since,
      {
        discordGuildId: options.discordGuildId,
        status: "sent",
      },
    );
    const commandCounts = this.metrics.getBucketCounts(
      "command_usages",
      options.format,
      options.since,
      {
        discordGuildId: options.discordGuildId,
      },
    );
    const failureCounts = this.metrics.getBucketCounts(
      "bot_failures",
      options.format,
      options.since,
      {
        affectsHealth: true,
        discordGuildId: options.discordGuildId,
      },
    );
    const automationCounts = this.metrics.getBucketCounts(
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
}
