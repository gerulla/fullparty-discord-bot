import type { DatabaseSync } from "node:sqlite";

import { openSqliteDatabase } from "../database/sqlite.js";
import {
  type FailureReporter,
  type HealthStatus,
  serializeFailureError,
} from "../health/failureReporter.js";
import type { Logger } from "../lib/logger.js";
import {
  type GuildAutomationJobData,
  type GuildAutomationJobKind,
  guildRunReminderDataSchema,
  guildRunCompletedDataSchema,
  type GuildRunReminderData,
} from "./runReminderTypes.js";

export type GuildRunReminderQueueEnqueueResult = {
  alreadyQueued: boolean;
  discordGuildId: string;
  jobId: number;
  jobKind: GuildAutomationJobKind;
  queueStatus: GuildRunReminderQueueStatus;
  queued: true;
  reminderType?: GuildRunReminderData["reminder_type"] | undefined;
  runId: number;
  type: GuildAutomationJobData["data"]["type"];
};

export type GuildRunReminderQueue = {
  enqueue(data: GuildAutomationJobData): Promise<GuildRunReminderQueueEnqueueResult>;
  getHealthSummary?(): Promise<GuildRunReminderQueueHealthSummary>;
};

export type GuildRunReminderQueueOptions = {
  concurrency?: number;
  databasePath: string;
  failureReporter?: FailureReporter | undefined;
  logger: Logger;
  maxAttempts?: number;
  pollIntervalMs?: number;
  processor: (data: GuildAutomationJobData) => Promise<Record<string, unknown>>;
};

export type GuildRunReminderQueueHealthSummary = {
  failedLastWindow: number;
  ok: boolean;
  oldestQueuedSeconds: number | null;
  queued: number;
  processing: number;
  status: HealthStatus;
  stuckProcessing: number;
  windowSeconds: number;
};

type GuildRunReminderQueueStatus = "queued" | "processing" | "completed" | "failed";

type GuildRunReminderQueueRow = {
  attempts: number;
  available_at: string;
  completed_at: string | null;
  created_at: string;
  dedupe_key: string;
  discord_guild_id: string;
  id: number;
  last_error: string | null;
  locked_at: string | null;
  job_kind: GuildAutomationJobKind;
  payload_json: string;
  reminder_type: GuildRunReminderQueueReminderType | null;
  result_json: string | null;
  run_id: number;
  status: GuildRunReminderQueueStatus;
  type: GuildAutomationJobData["data"]["type"];
  updated_at: string;
};

type GuildRunReminderQueueReminderType =
  | GuildRunReminderData["reminder_type"]
  | "completed";

type GuildRunReminderQueueJob = {
  attempts: number;
  data: GuildAutomationJobData;
  id: number;
};

export class SqliteGuildRunReminderQueue implements GuildRunReminderQueue {
  private readonly concurrency: number;
  private readonly database: DatabaseSync;
  private readonly failureReporter: FailureReporter | undefined;
  private readonly logger: Logger;
  private readonly maxAttempts: number;
  private readonly pollIntervalMs: number;
  private readonly processor: (
    data: GuildAutomationJobData,
  ) => Promise<Record<string, unknown>>;
  private activeJobCount = 0;
  private drainScheduled = false;
  private running = false;
  private timer: NodeJS.Timeout | undefined;

  public constructor(options: GuildRunReminderQueueOptions) {
    this.concurrency = Math.max(1, Math.floor(options.concurrency ?? 2));
    this.database = openSqliteDatabase(options.databasePath);
    this.failureReporter = options.failureReporter;
    this.logger = options.logger;
    this.maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 3));
    this.pollIntervalMs = Math.max(250, Math.floor(options.pollIntervalMs ?? 1000));
    this.processor = options.processor;
    this.initialize();
  }

  public start(): void {
    if (this.running) {
      return;
    }

    this.recoverProcessingJobs();
    this.running = true;
    this.timer = setInterval(() => {
      this.kick();
    }, this.pollIntervalMs);
    this.timer.unref();
    this.kick();
    this.logger.info("Guild automation queue started.", {
      concurrency: this.concurrency,
      pollIntervalMs: this.pollIntervalMs,
    });
  }

  public async stop(): Promise<void> {
    this.running = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    while (this.activeJobCount > 0) {
      await sleep(25);
    }

    this.database.close();
  }

  public enqueue(
    job: GuildAutomationJobData,
  ): Promise<GuildRunReminderQueueEnqueueResult> {
    const dedupeKey = createDedupeKey(job);
    const data = job.data;
    const reminderType =
      job.kind === "run_reminder" ? job.data.reminder_type : "completed";
    const now = new Date().toISOString();
    const payloadJson = JSON.stringify(data);
    const insertResult = this.database
      .prepare(
        `
          INSERT OR IGNORE INTO guild_run_reminder_jobs (
            available_at,
            created_at,
            dedupe_key,
            discord_guild_id,
            job_kind,
            payload_json,
            reminder_type,
            run_id,
            status,
            type,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
        `,
      )
      .run(
        now,
        now,
        dedupeKey,
        data.discord_guild_id,
        job.kind,
        payloadJson,
        reminderType,
        data.run_id,
        data.type,
        now,
      );
    const row = this.getJobByDedupeKey(dedupeKey);

    if (!row) {
      throw new Error("Expected queued guild run reminder job to exist.");
    }

    this.kick();

    return Promise.resolve({
      alreadyQueued: insertResult.changes === 0,
      discordGuildId: row.discord_guild_id,
      jobId: row.id,
      jobKind: row.job_kind,
      queueStatus: row.status,
      queued: true,
      ...(isRunReminderType(row.reminder_type)
        ? { reminderType: row.reminder_type }
        : {}),
      runId: row.run_id,
      type: row.type,
    });
  }

  public getHealthSummary(): Promise<GuildRunReminderQueueHealthSummary> {
    const now = new Date();
    const windowSeconds = 600;
    const failedSince = new Date(now.getTime() - windowSeconds * 1000).toISOString();
    const stuckProcessingSince = new Date(
      now.getTime() - windowSeconds * 1000,
    ).toISOString();
    const queued = this.getStatusCount("queued");
    const processing = this.getStatusCount("processing");
    const failedLastWindow = this.database
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM guild_run_reminder_jobs
          WHERE status = 'failed'
            AND completed_at >= ?
        `,
      )
      .get(failedSince) as { count: number };
    const oldestQueued = this.database
      .prepare(
        `
          SELECT MIN(created_at) AS created_at
          FROM guild_run_reminder_jobs
          WHERE status = 'queued'
        `,
      )
      .get() as { created_at: string | null };
    const stuckProcessing = this.database
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM guild_run_reminder_jobs
          WHERE status = 'processing'
            AND locked_at <= ?
        `,
      )
      .get(stuckProcessingSince) as { count: number };
    const oldestQueuedSeconds = oldestQueued.created_at
      ? Math.max(
          0,
          Math.floor((now.getTime() - Date.parse(oldestQueued.created_at)) / 1000),
        )
      : null;
    const status = getQueueStatus({
      failedLastWindow: failedLastWindow.count,
      oldestQueuedSeconds,
      stuckProcessing: stuckProcessing.count,
    });

    return Promise.resolve({
      failedLastWindow: failedLastWindow.count,
      ok: status === "healthy",
      oldestQueuedSeconds,
      processing,
      queued,
      status,
      stuckProcessing: stuckProcessing.count,
      windowSeconds,
    });
  }

  private initialize(): void {
    this.database.exec(`
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
    this.addColumnIfMissing(
      "guild_run_reminder_jobs",
      "job_kind",
      "TEXT NOT NULL DEFAULT 'run_reminder'",
    );
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS guild_run_reminder_jobs_status_available_idx
      ON guild_run_reminder_jobs (status, available_at, created_at)
    `);
  }

  private addColumnIfMissing(
    tableName: string,
    columnName: string,
    definition: string,
  ): void {
    const rows = this.database.prepare(`PRAGMA table_info(${tableName})`).all() as {
      name: string;
    }[];

    if (rows.some((row) => row.name === columnName)) {
      return;
    }

    this.database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }

  private recoverProcessingJobs(): void {
    const now = new Date().toISOString();

    this.database
      .prepare(
        `
          UPDATE guild_run_reminder_jobs
          SET
            available_at = ?,
            last_error = 'Recovered after queue restart.',
            locked_at = NULL,
            status = 'queued',
            updated_at = ?
          WHERE status = 'processing'
        `,
      )
      .run(now, now);
  }

  private kick(): void {
    if (!this.running || this.drainScheduled) {
      return;
    }

    this.drainScheduled = true;
    queueMicrotask(() => {
      this.drainScheduled = false;
      this.drain();
    });
  }

  private drain(): void {
    while (this.running && this.activeJobCount < this.concurrency) {
      const job = this.claimNextJob();

      if (!job) {
        return;
      }

      this.activeJobCount += 1;
      void this.processJob(job).finally(() => {
        this.activeJobCount -= 1;
        this.kick();
      });
    }
  }

  private claimNextJob(): GuildRunReminderQueueJob | undefined {
    const now = new Date().toISOString();
    const row = this.database
      .prepare(
        `
          SELECT *
          FROM guild_run_reminder_jobs
          WHERE status = 'queued'
            AND available_at <= ?
          ORDER BY created_at ASC, id ASC
          LIMIT 1
        `,
      )
      .get(now) as GuildRunReminderQueueRow | undefined;

    if (!row) {
      return undefined;
    }

    this.database
      .prepare(
        `
          UPDATE guild_run_reminder_jobs
          SET
            attempts = attempts + 1,
            locked_at = ?,
            status = 'processing',
            updated_at = ?
          WHERE id = ?
        `,
      )
      .run(now, now, row.id);

    return {
      attempts: row.attempts + 1,
      data: parseJobPayload(row),
      id: row.id,
    };
  }

  private async processJob(job: GuildRunReminderQueueJob): Promise<void> {
    try {
      const result = await this.processor(job.data);
      const now = new Date().toISOString();

      this.database
        .prepare(
          `
            UPDATE guild_run_reminder_jobs
            SET
              completed_at = ?,
              last_error = NULL,
              locked_at = NULL,
              result_json = ?,
              status = 'completed',
              updated_at = ?
            WHERE id = ?
          `,
        )
        .run(now, JSON.stringify(result), now, job.id);
    } catch (error) {
      this.handleJobError(job, error);
    }
  }

  private handleJobError(job: GuildRunReminderQueueJob, error: unknown): void {
    const errorMessage = getErrorMessage(error);
    const now = new Date().toISOString();

    if (job.attempts < this.maxAttempts) {
      const retryAt = new Date(
        Date.now() + Math.min(60_000, 1000 * 2 ** (job.attempts - 1)),
      ).toISOString();

      this.database
        .prepare(
          `
            UPDATE guild_run_reminder_jobs
            SET
              available_at = ?,
              last_error = ?,
              locked_at = NULL,
              status = 'queued',
              updated_at = ?
            WHERE id = ?
          `,
        )
        .run(retryAt, errorMessage, now, job.id);
      this.logger.warn("Guild automation job failed and will retry.", {
        attempts: job.attempts,
        error: errorMessage,
        jobId: job.id,
        retryAt,
      });
      void this.failureReporter
        ?.record({
          action: "guild_automation_job_retry",
          details: {
            attempts: job.attempts,
            job: job.data,
            retryAt,
            serializedError: serializeFailureError(error),
          },
          discordGuildId: job.data.data.discord_guild_id,
          errorCode: "guild_automation_job_retry",
          eventType: job.data.data.type,
          message: errorMessage,
          runId: job.data.data.run_id,
          severity: "warn",
          source: "queue",
        })
        .catch((failureError: unknown) => {
          this.logger.error("Unable to record guild automation retry failure.", {
            error: failureError,
          });
        });
      return;
    }

    this.database
      .prepare(
        `
          UPDATE guild_run_reminder_jobs
          SET
            completed_at = ?,
            last_error = ?,
            locked_at = NULL,
            status = 'failed',
            updated_at = ?
          WHERE id = ?
        `,
      )
      .run(now, errorMessage, now, job.id);
    this.logger.error("Guild automation job failed permanently.", {
      attempts: job.attempts,
      error: errorMessage,
      jobId: job.id,
    });
    void this.failureReporter
      ?.record({
        action: "guild_automation_job_failed",
        details: {
          attempts: job.attempts,
          job: job.data,
          serializedError: serializeFailureError(error),
        },
        discordGuildId: job.data.data.discord_guild_id,
        errorCode: "guild_automation_job_failed",
        eventType: job.data.data.type,
        message: errorMessage,
        runId: job.data.data.run_id,
        severity: "error",
        source: "queue",
      })
      .catch((failureError: unknown) => {
        this.logger.error("Unable to record permanent guild automation failure.", {
          error: failureError,
        });
      });
  }

  private getStatusCount(status: GuildRunReminderQueueStatus): number {
    const row = this.database
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM guild_run_reminder_jobs
          WHERE status = ?
        `,
      )
      .get(status) as { count: number };

    return row.count;
  }

  private getJobByDedupeKey(dedupeKey: string): GuildRunReminderQueueRow | undefined {
    return this.database
      .prepare(
        `
          SELECT *
          FROM guild_run_reminder_jobs
          WHERE dedupe_key = ?
        `,
      )
      .get(dedupeKey) as GuildRunReminderQueueRow | undefined;
  }
}

function parseJobPayload(row: GuildRunReminderQueueRow): GuildAutomationJobData {
  const payload = JSON.parse(row.payload_json) as unknown;

  if (row.job_kind === "run_completed") {
    return {
      data: guildRunCompletedDataSchema.parse(payload),
      kind: "run_completed",
    };
  }

  return {
    data: guildRunReminderDataSchema.parse(payload),
    kind: "run_reminder",
  };
}

function createDedupeKey(job: GuildAutomationJobData): string {
  return [
    job.kind,
    job.data.discord_guild_id,
    String(job.data.run_id),
    job.data.type,
  ].join(":");
}

function isRunReminderType(
  reminderType: GuildRunReminderQueueReminderType | null,
): reminderType is GuildRunReminderData["reminder_type"] {
  return reminderType === "starting_now" || reminderType === "starting_soon";
}

function getQueueStatus(input: {
  failedLastWindow: number;
  oldestQueuedSeconds: number | null;
  stuckProcessing: number;
}): HealthStatus {
  if (
    input.stuckProcessing > 0 ||
    (input.oldestQueuedSeconds !== null && input.oldestQueuedSeconds >= 600) ||
    input.failedLastWindow >= 5
  ) {
    return "unhealthy";
  }

  if (
    input.failedLastWindow > 0 ||
    (input.oldestQueuedSeconds !== null && input.oldestQueuedSeconds >= 120)
  ) {
    return "degraded";
  }

  return "healthy";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
