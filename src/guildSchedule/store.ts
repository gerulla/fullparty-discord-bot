import type { DatabaseSync } from "node:sqlite";
import { openSqliteDatabase } from "../database/sqlite.js";
import type { GuildSettings } from "../guildSettings/types.js";
import {
  dayMs,
  getScheduleMode,
  scheduleIntervalDaysSchema,
  scheduleModeSchema,
  type ScheduleFormat,
  type ScheduleMode,
} from "./settings.js";

export type ScheduleState = {
  guild_id: string;
  enabled: number;
  mode: ScheduleMode;
  refresh_pending: number;
  channel_id: string | null;
  interval_days: number;
  revision: number;
  message_id: string | null;
  message_channel_id: string | null;
  next_refresh_at: string;
  last_refreshed_at: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
};
export type ScheduleJob = ScheduleState & {
  channel_id: string;
  linked_at: string;
  schedule_format: ScheduleFormat;
};

export function readScheduleSettings(
  database: DatabaseSync,
  guildId: string,
): Partial<GuildSettings> {
  const row = database
    .prepare("SELECT * FROM guild_schedule_refresh WHERE guild_id = ?")
    .get(guildId) as ScheduleState | undefined;
  return row
    ? {
        scheduleRefreshEnabled: row.enabled === 1,
        scheduleMode: row.mode,
        scheduleRefreshIntervalDays: row.interval_days,
        ...(row.channel_id ? { scheduleRefreshChannelId: row.channel_id } : {}),
      }
    : {};
}

export function writeScheduleSettings(
  database: DatabaseSync,
  current: GuildSettings,
  next: GuildSettings,
): void {
  const interval = scheduleIntervalDaysSchema.parse(
    next.scheduleRefreshIntervalDays ?? 1,
  );
  const mode = scheduleModeSchema.parse(getScheduleMode(next));
  const modeChanged = getScheduleMode(current) !== mode;
  const channelChanged =
    current.runAnnouncementChannelId !== next.runAnnouncementChannelId;
  const linkChanged = current.linkedAt !== next.linkedAt;
  const intervalChanged = (current.scheduleRefreshIntervalDays ?? 1) !== interval;
  const formatChanged =
    (current.scheduleFormat ?? "plain") !== (next.scheduleFormat ?? "plain");
  if (
    !modeChanged &&
    !channelChanged &&
    !linkChanged &&
    !(mode !== "disabled" && formatChanged) &&
    !(mode === "timed_refresh" && intervalChanged)
  ) {
    // Keep a remembered interval without waking an event-driven or disabled schedule.
    if (intervalChanged)
      database
        .prepare(
          `INSERT INTO guild_schedule_refresh
        (guild_id, enabled, mode, refresh_pending, channel_id, interval_days, next_refresh_at)
        VALUES (?, ?, ?, 0, ?, ?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET interval_days = excluded.interval_days`,
        )
        .run(
          next.guildId,
          mode !== "disabled" ? 1 : 0,
          mode,
          next.runAnnouncementChannelId ?? null,
          interval,
          new Date().toISOString(),
        );
    return;
  }

  database
    .prepare(
      `INSERT INTO guild_schedule_refresh
    (guild_id, enabled, mode, refresh_pending, channel_id, interval_days, next_refresh_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      enabled = excluded.enabled, mode = excluded.mode,
      refresh_pending = excluded.refresh_pending, channel_id = excluded.channel_id,
      interval_days = excluded.interval_days, next_refresh_at = excluded.next_refresh_at,
      revision = guild_schedule_refresh.revision + 1, last_error = NULL`,
    )
    .run(
      next.guildId,
      mode !== "disabled" ? 1 : 0,
      mode,
      mode !== "disabled" ? 1 : 0,
      next.runAnnouncementChannelId ?? null,
      interval,
      new Date().toISOString(),
    );
}

export class SqliteGuildScheduleStore {
  private readonly database;
  public constructor(databasePath: string) {
    this.database = openSqliteDatabase(databasePath);
  }

  public get(guildId: string): ScheduleState | undefined {
    return this.database
      .prepare("SELECT * FROM guild_schedule_refresh WHERE guild_id = ?")
      .get(guildId) as ScheduleState | undefined;
  }

  public listDue(now: Date): ScheduleJob[] {
    return this.database
      .prepare(
        `SELECT schedule.*, settings.linked_at, settings.schedule_format
      FROM guild_schedule_refresh schedule JOIN guild_settings settings USING (guild_id)
      WHERE (schedule.mode = 'timed_refresh' OR
          (schedule.mode = 'run_detection' AND schedule.refresh_pending = 1))
        AND schedule.channel_id IS NOT NULL
        AND settings.linked_at IS NOT NULL AND schedule.next_refresh_at <= ?
      ORDER BY schedule.next_refresh_at, schedule.guild_id`,
      )
      .all(now.toISOString()) as ScheduleJob[];
  }

  public isCurrent(job: ScheduleJob): boolean {
    return Boolean(
      this.database
        .prepare(
          `SELECT 1 FROM guild_schedule_refresh schedule
      JOIN guild_settings settings USING (guild_id)
      WHERE schedule.guild_id = ? AND schedule.revision = ? AND schedule.mode != 'disabled'
        AND settings.linked_at = ?`,
        )
        .get(job.guild_id, job.revision, job.linked_at),
    );
  }

  public requestRunDetectionRefresh(guildId: string, now = new Date()): boolean {
    // One durable row coalesces changes. Each hint invalidates an in-flight snapshot;
    // completing that older attempt cannot clear the newly requested refresh.
    return (
      this.database
        .prepare(
          `
      UPDATE guild_schedule_refresh
      SET refresh_pending = 1, next_refresh_at = ?, revision = revision + 1
      WHERE guild_id = ? AND mode = 'run_detection' AND channel_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM guild_settings
          WHERE guild_settings.guild_id = guild_schedule_refresh.guild_id
            AND linked_at IS NOT NULL)
    `,
        )
        .run(now.toISOString(), guildId).changes > 0
    );
  }

  public markAttempt(job: ScheduleJob, now: Date): void {
    this.database
      .prepare(
        "UPDATE guild_schedule_refresh SET last_attempt_at = ? WHERE guild_id = ? AND revision = ?",
      )
      .run(now.toISOString(), job.guild_id, job.revision);
  }

  public clearMessage(job: ScheduleJob): void {
    this.database
      .prepare(
        `UPDATE guild_schedule_refresh SET message_id = NULL, message_channel_id = NULL
      WHERE guild_id = ? AND message_id = ?`,
      )
      .run(job.guild_id, job.message_id);
  }

  public complete(job: ScheduleJob, messageId: string, now: Date): void {
    // Keep a newly sent message tracked even if settings changed during the Discord request.
    this.database
      .prepare(
        `UPDATE guild_schedule_refresh SET message_id = ?, message_channel_id = ?,
      last_refreshed_at = ?, last_error = NULL,
      next_refresh_at = CASE WHEN revision = ? THEN ? ELSE next_refresh_at END,
      refresh_pending = CASE WHEN revision = ? THEN 0 ELSE refresh_pending END
      WHERE guild_id = ?`,
      )
      .run(
        messageId,
        job.channel_id,
        now.toISOString(),
        job.revision,
        new Date(now.getTime() + job.interval_days * dayMs).toISOString(),
        job.revision,
        job.guild_id,
      );
  }

  public fail(job: ScheduleJob, error: string, now: Date): void {
    this.database
      .prepare(
        `UPDATE guild_schedule_refresh SET last_error = ?, next_refresh_at = ?
      WHERE guild_id = ? AND revision = ?`,
      )
      .run(
        error,
        new Date(now.getTime() + 3_600_000).toISOString(),
        job.guild_id,
        job.revision,
      );
  }

  public close(): void {
    this.database.close();
  }
}
