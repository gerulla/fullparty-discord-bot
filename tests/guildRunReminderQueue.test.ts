import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  SqliteGuildRunReminderQueue,
  type GuildRunReminderQueueOptions,
} from "../src/guildAutomation/runReminderQueue.js";
import type { GuildRunReminderData } from "../src/guildAutomation/runReminderTypes.js";

describe("SqliteGuildRunReminderQueue", () => {
  const queues: SqliteGuildRunReminderQueue[] = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(queues.splice(0).map((queue) => queue.stop()));
    await Promise.all(
      tempDirs.splice(0).map((directory) =>
        rm(directory, {
          force: true,
          recursive: true,
        }),
      ),
    );
  });

  it("deduplicates the same guild run reminder", async () => {
    const { queue } = await createQueue();
    const firstResult = await queue.enqueue({
      data: createRunReminderData(),
      kind: "run_reminder",
    });
    const secondResult = await queue.enqueue({
      data: createRunReminderData(),
      kind: "run_reminder",
    });

    expect(firstResult).toMatchObject({
      alreadyQueued: false,
      discordGuildId: "guild-id",
      jobKind: "run_reminder",
      queueStatus: "queued",
      queued: true,
      reminderType: "starting_soon",
      runId: 123,
      type: "runs.starting_soon",
    });
    expect(secondResult).toMatchObject({
      alreadyQueued: true,
      jobId: firstResult.jobId,
      queueStatus: "queued",
    });
  });

  it("processes queued jobs with bounded concurrency", async () => {
    const processedRunIds: number[] = [];
    const { databasePath, queue } = await createQueue({
      concurrency: 1,
      processor: (job) => {
        processedRunIds.push(job.data.run_id);
        return Promise.resolve({ runId: job.data.run_id });
      },
    });

    queue.start();

    await queue.enqueue({
      data: createRunReminderData({ runId: 1 }),
      kind: "run_reminder",
    });
    await queue.enqueue({
      data: createRunReminderData({ runId: 2 }),
      kind: "run_reminder",
    });
    await waitFor(() => processedRunIds.length === 2);
    await queue.stop();
    queues.splice(queues.indexOf(queue), 1);

    expect(processedRunIds).toEqual([1, 2]);
    expect(readJobStatuses(databasePath)).toEqual(["completed", "completed"]);
  });

  it("queues completed run cleanup jobs separately from reminder jobs", async () => {
    const { queue } = await createQueue();
    const reminderResult = await queue.enqueue({
      data: createRunReminderData({ runId: 123 }),
      kind: "run_reminder",
    });
    const completedResult = await queue.enqueue({
      data: {
        discord_guild_id: "guild-id",
        participants: [],
        run_id: 123,
        type: "runs.completed",
      },
      kind: "run_completed",
    });

    expect(reminderResult).toMatchObject({
      alreadyQueued: false,
      jobKind: "run_reminder",
      runId: 123,
    });
    expect(completedResult).toMatchObject({
      alreadyQueued: false,
      jobKind: "run_completed",
      runId: 123,
    });
    expect(completedResult.jobId).not.toBe(reminderResult.jobId);
  });

  async function createQueue(
    options: Partial<GuildRunReminderQueueOptions> = {},
  ): Promise<{
    databasePath: string;
    queue: SqliteGuildRunReminderQueue;
  }> {
    const directory = await mkdtemp(join(tmpdir(), "fullparty-run-queue-"));
    const databasePath = join(directory, "queue.sqlite");
    const queue = new SqliteGuildRunReminderQueue({
      concurrency: 2,
      databasePath,
      logger: {
        debug: () => undefined,
        error: () => undefined,
        info: () => undefined,
        warn: () => undefined,
      },
      pollIntervalMs: 250,
      processor: () => Promise.resolve({ ok: true }),
      ...options,
    });

    tempDirs.push(directory);
    queues.push(queue);

    return {
      databasePath,
      queue,
    };
  }
});

function createRunReminderData(
  overrides: {
    reminderType?: GuildRunReminderData["reminder_type"];
    runId?: number;
  } = {},
): GuildRunReminderData {
  const reminderType = overrides.reminderType ?? "starting_soon";

  return {
    discord_guild_id: "guild-id",
    discord_user_ids: ["123"],
    participants: [],
    reminder_type: reminderType,
    run_id: overrides.runId ?? 123,
    type: reminderType === "starting_now" ? "runs.starting_now" : "runs.starting_soon",
  };
}

function readJobStatuses(databasePath: string): string[] {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  const rows = database
    .prepare(
      `
        SELECT status
        FROM guild_run_reminder_jobs
        ORDER BY id ASC
      `,
    )
    .all() as { status: string }[];

  database.close();

  return rows.map((row) => row.status);
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > 2000) {
      throw new Error("Timed out waiting for condition.");
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
