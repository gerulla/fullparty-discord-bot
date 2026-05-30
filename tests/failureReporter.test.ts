import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { SqliteFailureReporter } from "../src/health/failureReporter.js";

describe("SqliteFailureReporter", () => {
  const reporters: SqliteFailureReporter[] = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    reporters.splice(0).forEach((reporter) => {
      reporter.close();
    });
    await Promise.all(
      tempDirs.splice(0).map((directory) =>
        rm(directory, {
          force: true,
          recursive: true,
        }),
      ),
    );
  });

  it("records failures to sqlite and a jsonl file", async () => {
    const { logFilePath, reporter } = await createReporter();

    await reporter.record({
      action: "run_role_assign",
      details: {
        failedUserCount: 2,
      },
      discordGuildId: "guild-id",
      errorCode: "role_assignment_failed",
      eventType: "runs.starting_soon",
      message: "2 role assignments failed.",
      runId: 123,
      severity: "warn",
      source: "guild_automation",
    });

    await expect(
      reporter.getHealthSummary({
        now: new Date(),
        windowSeconds: 600,
      }),
    ).resolves.toMatchObject({
      errorCount: 0,
      ok: false,
      status: "degraded",
      warnCount: 1,
      windowSeconds: 600,
    });

    const logLines = (await readFile(logFilePath, "utf8")).trim().split("\n");

    expect(logLines).toHaveLength(1);
    expect(JSON.parse(logLines[0] ?? "{}")).toMatchObject({
      action: "run_role_assign",
      discordGuildId: "guild-id",
      severity: "warn",
      source: "guild_automation",
    });
  });

  it("marks recent repeated errors unhealthy and lets old failures age out", async () => {
    const { reporter } = await createReporter();
    for (let index = 0; index < 5; index += 1) {
      await reporter.record({
        action: "event_processing",
        message: `failure ${String(index)}`,
        severity: "error",
        source: "webhook",
      });
    }

    const now = new Date();

    await expect(
      reporter.getHealthSummary({
        now,
        unhealthyErrorThreshold: 5,
        windowSeconds: 600,
      }),
    ).resolves.toMatchObject({
      errorCount: 5,
      ok: false,
      status: "unhealthy",
    });

    await expect(
      reporter.getHealthSummary({
        now: new Date(now.getTime() + 601_000),
        unhealthyErrorThreshold: 5,
        windowSeconds: 600,
      }),
    ).resolves.toMatchObject({
      errorCount: 0,
      ok: true,
      status: "healthy",
    });
  });

  it("logs expected failures without affecting health", async () => {
    const { logFilePath, reporter } = await createReporter();

    await reporter.record({
      action: "run_role_assign",
      affectsHealth: false,
      details: {
        reason: "bot_missing_manage_roles",
      },
      errorCode: "bot_missing_manage_roles",
      message: "The bot cannot assign the run role because of Discord permissions.",
      severity: "warn",
      source: "guild_automation",
    });

    await expect(
      reporter.getHealthSummary({
        now: new Date(),
        windowSeconds: 600,
      }),
    ).resolves.toMatchObject({
      errorCount: 0,
      ignoredCount: 1,
      ok: true,
      status: "healthy",
      warnCount: 0,
    });

    const logLines = (await readFile(logFilePath, "utf8")).trim().split("\n");

    expect(JSON.parse(logLines[0] ?? "{}")).toMatchObject({
      action: "run_role_assign",
      affectsHealth: false,
      errorCode: "bot_missing_manage_roles",
    });
  });

  async function createReporter(): Promise<{
    logFilePath: string;
    reporter: SqliteFailureReporter;
  }> {
    const directory = await mkdtemp(join(tmpdir(), "fullparty-failures-"));
    const databasePath = join(directory, "failures.sqlite");
    const logFilePath = join(directory, "failures.jsonl");
    const reporter = new SqliteFailureReporter({
      databasePath,
      logFilePath,
    });

    tempDirs.push(directory);
    reporters.push(reporter);

    return {
      logFilePath,
      reporter,
    };
  }
});
