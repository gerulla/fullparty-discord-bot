import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { openSqliteDatabase } from "../database/sqlite.js";
import type { Logger } from "../lib/logger.js";

export type HealthStatus = "healthy" | "degraded" | "unhealthy";
export type BotFailureSeverity = "warn" | "error";

export type BotFailureInput = {
  action: string;
  affectsHealth?: boolean | undefined;
  details?: unknown;
  discordGuildId?: string | undefined;
  discordUserId?: string | undefined;
  errorCode?: string | undefined;
  eventType?: string | undefined;
  message: string;
  runId?: number | undefined;
  severity: BotFailureSeverity;
  source:
    | "command"
    | "component"
    | "discord_api"
    | "fullparty_api"
    | "guild_automation"
    | "guild_membership"
    | "queue"
    | "webhook";
};

export type BotFailureRecord = BotFailureInput & {
  id: number;
  occurredAt: string;
};

export type FailureHealthSummary = {
  errorCount: number;
  ignoredCount: number;
  last24h: {
    count: number;
    errorCount: number;
    ignoredCount: number;
    topSources: Record<string, number>;
    warnCount: number;
  };
  lastFailureAt: string | null;
  ok: boolean;
  status: HealthStatus;
  unhealthyErrorThreshold: number;
  warnCount: number;
  windowSeconds: number;
};

export type FailureReporter = {
  close?(): void;
  getHealthSummary(options?: FailureHealthSummaryOptions): Promise<FailureHealthSummary>;
  record(input: BotFailureInput): Promise<BotFailureRecord>;
};

export type FailureReporterOptions = {
  databasePath: string;
  logFilePath?: string | undefined;
};

export type FailureHealthSummaryOptions = {
  now?: Date | undefined;
  summaryWindowSeconds?: number | undefined;
  unhealthyErrorThreshold?: number | undefined;
  windowSeconds?: number | undefined;
};

type FailureCountRow = {
  count: number;
  error_count: number;
  ignored_count: number;
  last_failure_at: string | null;
  warn_count: number;
};

type SourceCountRow = {
  count: number;
  source: string;
};

export class SqliteFailureReporter implements FailureReporter {
  private readonly database: DatabaseSync;
  private readonly logFilePath: string | undefined;

  public constructor(options: FailureReporterOptions) {
    this.database = openSqliteDatabase(options.databasePath);
    this.logFilePath = options.logFilePath;
    this.initialize();
  }

  public record(input: BotFailureInput): Promise<BotFailureRecord> {
    const occurredAt = new Date().toISOString();
    const affectsHealth = input.affectsHealth ?? true;
    const detailsJson = input.details === undefined ? null : safeStringify(input.details);
    const result = this.database
      .prepare(
        `
          INSERT INTO bot_failures (
            action,
            affects_health,
            details_json,
            discord_guild_id,
            discord_user_id,
            error_code,
            event_type,
            message,
            occurred_at,
            run_id,
            severity,
            source
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.action,
        affectsHealth ? 1 : 0,
        detailsJson,
        input.discordGuildId ?? null,
        input.discordUserId ?? null,
        input.errorCode ?? null,
        input.eventType ?? null,
        input.message,
        occurredAt,
        input.runId ?? null,
        input.severity,
        input.source,
      );
    const id = Number(result.lastInsertRowid);
    const record: BotFailureRecord = {
      ...input,
      affectsHealth,
      id,
      occurredAt,
    };

    this.writeFileRecord(record);

    return Promise.resolve(record);
  }

  public getHealthSummary(
    options: FailureHealthSummaryOptions = {},
  ): Promise<FailureHealthSummary> {
    const now = options.now ?? new Date();
    const windowSeconds = options.windowSeconds ?? 600;
    const summaryWindowSeconds = options.summaryWindowSeconds ?? 86_400;
    const unhealthyErrorThreshold = options.unhealthyErrorThreshold ?? 5;
    const currentSince = new Date(now.getTime() - windowSeconds * 1000).toISOString();
    const summarySince = new Date(
      now.getTime() - summaryWindowSeconds * 1000,
    ).toISOString();
    const currentCounts = this.getCountsSince(currentSince);
    const summaryCounts = this.getCountsSince(summarySince);
    const status = getFailureStatus(
      currentCounts.error_count,
      currentCounts.warn_count,
      unhealthyErrorThreshold,
    );

    return Promise.resolve({
      errorCount: currentCounts.error_count,
      ignoredCount: currentCounts.ignored_count,
      last24h: {
        count: summaryCounts.count,
        errorCount: summaryCounts.error_count,
        ignoredCount: summaryCounts.ignored_count,
        topSources: this.getTopSourcesSince(summarySince),
        warnCount: summaryCounts.warn_count,
      },
      lastFailureAt: currentCounts.last_failure_at,
      ok: status === "healthy",
      status,
      unhealthyErrorThreshold,
      warnCount: currentCounts.warn_count,
      windowSeconds,
    });
  }

  public close(): void {
    this.database.close();
  }

  private initialize(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS bot_failures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        occurred_at TEXT NOT NULL,
        affects_health INTEGER NOT NULL DEFAULT 1
          CHECK (affects_health IN (0, 1)),
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
    this.addColumnIfMissing(
      "bot_failures",
      "affects_health",
      "INTEGER NOT NULL DEFAULT 1 CHECK (affects_health IN (0, 1))",
    );
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS bot_failures_occurred_at_idx
      ON bot_failures (occurred_at)
    `);
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS bot_failures_source_occurred_at_idx
      ON bot_failures (source, occurred_at)
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

  private getCountsSince(since: string): FailureCountRow {
    return this.database
      .prepare(
        `
          SELECT
            COALESCE(SUM(CASE WHEN affects_health = 1 THEN 1 ELSE 0 END), 0) AS count,
            COALESCE(SUM(CASE WHEN affects_health = 1 AND severity = 'error' THEN 1 ELSE 0 END), 0) AS error_count,
            COALESCE(SUM(CASE WHEN affects_health = 0 THEN 1 ELSE 0 END), 0) AS ignored_count,
            MAX(CASE WHEN affects_health = 1 THEN occurred_at ELSE NULL END) AS last_failure_at,
            COALESCE(SUM(CASE WHEN affects_health = 1 AND severity = 'warn' THEN 1 ELSE 0 END), 0) AS warn_count
          FROM bot_failures
          WHERE occurred_at >= ?
        `,
      )
      .get(since) as FailureCountRow;
  }

  private getTopSourcesSince(since: string): Record<string, number> {
    const rows = this.database
      .prepare(
        `
          SELECT source, COUNT(*) AS count
          FROM bot_failures
          WHERE occurred_at >= ?
            AND affects_health = 1
          GROUP BY source
          ORDER BY count DESC, source ASC
          LIMIT 5
        `,
      )
      .all(since) as SourceCountRow[];

    return Object.fromEntries(rows.map((row) => [row.source, row.count]));
  }

  private writeFileRecord(record: BotFailureRecord): void {
    if (!this.logFilePath) {
      return;
    }

    mkdirSync(dirname(this.logFilePath), { recursive: true });
    appendFileSync(this.logFilePath, `${safeStringify(record)}\n`, "utf8");
  }
}

export function recordFailureSafely(
  reporter: FailureReporter | undefined,
  logger: Logger,
  input: BotFailureInput,
): void {
  if (!reporter) {
    return;
  }

  void reporter.record(input).catch((error: unknown) => {
    logger.error("Unable to record bot failure.", { error });
  });
}

export function serializeFailureError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }

  return {
    value: error,
  };
}

function getFailureStatus(
  recentErrorCount: number,
  recentWarnCount: number,
  unhealthyErrorThreshold: number,
): HealthStatus {
  if (recentErrorCount >= unhealthyErrorThreshold) {
    return "unhealthy";
  }

  if (recentErrorCount > 0 || recentWarnCount > 0) {
    return "degraded";
  }

  return "healthy";
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
