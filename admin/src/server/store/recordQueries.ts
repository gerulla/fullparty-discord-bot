import type { DatabaseSync } from "node:sqlite";
import type {
  AdminAutomationRunRecord,
  AdminBotEventRecord,
  AdminCommandUsageRecord,
  AdminDmDeliveryRecord,
  AdminFailureRecord,
  AdminGuildMessageRecord,
  AdminGuildRecord,
  AdminQueueSummary,
} from "../../shared/telemetry.js";
import { normalizeLimit } from "./queryHelpers.js";
import type {
  AutomationRunRow,
  BotEventRow,
  CommandUsageRow,
  CountRow,
  DmDeliveryRow,
  FailureRow,
  GuildMessageRow,
  GuildRow,
  StatusCountRow,
} from "./rows.js";
import {
  rowToAutomationRun,
  rowToBotEvent,
  rowToCommandUsage,
  rowToDmDelivery,
  rowToFailure,
  rowToGuild,
  rowToGuildMessage,
} from "./rows.js";

export class AdminRecordQueries {
  public constructor(private readonly database: DatabaseSync) {}
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
}
