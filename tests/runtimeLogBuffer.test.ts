import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createRuntimeLogBuffer,
  installConsoleLogCapture,
} from "../src/lib/runtimeLogBuffer.js";

describe("runtime log buffer", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs.splice(0).map((directory) =>
        rm(directory, {
          force: true,
          recursive: true,
        }),
      ),
    );
  });

  it("keeps the newest entries first and trims to the configured limit", () => {
    const buffer = createRuntimeLogBuffer({ maxLines: 3 });

    buffer.append("info", "first", new Date("2026-06-01T10:00:00.000Z"));
    buffer.append("warn", "second", new Date("2026-06-01T10:01:00.000Z"));
    buffer.append("error", "third", new Date("2026-06-01T10:02:00.000Z"));
    buffer.append("log", "fourth", new Date("2026-06-01T10:03:00.000Z"));

    expect(buffer.getTotalBuffered()).toBe(3);
    expect(buffer.getEntries()).toMatchObject([
      { level: "log", message: "fourth" },
      { level: "error", message: "third" },
      { level: "warn", message: "second" },
    ]);
  });

  it("splits multi-line output into separate buffered lines", () => {
    const buffer = createRuntimeLogBuffer({ maxLines: 10 });

    buffer.append("error", "top\nstack line\n");

    expect(buffer.getEntries()).toMatchObject([
      { message: "stack line" },
      { message: "top" },
    ]);
  });

  it("captures console output without swallowing the original console method", () => {
    const buffer = createRuntimeLogBuffer({ maxLines: 10 });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const restore = installConsoleLogCapture(buffer);

    try {
      console.log("hello", { ok: true });
    } finally {
      restore();
    }

    expect(logSpy).toHaveBeenCalledWith("hello", { ok: true });
    expect(buffer.getEntries()).toMatchObject([
      {
        level: "log",
        message: 'hello {"ok":true}',
      },
    ]);
  });

  it("persists new log entries to daily jsonl files", async () => {
    const directoryPath = await createTempDir(tempDirs);
    const buffer = createRuntimeLogBuffer({ maxLines: 10 });

    buffer.configureFilePersistence({
      directoryPath,
      now: new Date("2026-06-01T10:00:00.000Z"),
      retentionDays: 30,
    });
    buffer.append("info", "saved to disk", new Date("2026-06-01T10:15:00.000Z"));

    await expect(
      readJsonlFile(
        join(directoryPath, "fullparty-discord-bot-console-2026-06-01.jsonl"),
      ),
    ).resolves.toMatchObject([
      {
        level: "info",
        message: "saved to disk",
        timestamp: "2026-06-01T10:15:00.000Z",
      },
    ]);
  });

  it("flushes logs captured before file persistence is configured", async () => {
    const directoryPath = await createTempDir(tempDirs);
    const buffer = createRuntimeLogBuffer({ maxLines: 10 });

    buffer.append("log", "boot line", new Date("2026-06-01T09:59:00.000Z"));
    buffer.configureFilePersistence({
      directoryPath,
      now: new Date("2026-06-01T10:00:00.000Z"),
      retentionDays: 30,
    });

    await expect(
      readJsonlFile(
        join(directoryPath, "fullparty-discord-bot-console-2026-06-01.jsonl"),
      ),
    ).resolves.toMatchObject([
      {
        level: "log",
        message: "boot line",
      },
    ]);
  });

  it("loads recent persisted entries and purges files outside retention", async () => {
    const directoryPath = await createTempDir(tempDirs);
    const buffer = createRuntimeLogBuffer({ maxLines: 10 });

    await writeFile(
      join(directoryPath, "fullparty-discord-bot-console-2026-05-30.jsonl"),
      `${JSON.stringify({
        level: "info",
        message: "expired",
        timestamp: "2026-05-30T23:59:00.000Z",
      })}\n`,
    );
    await writeFile(
      join(directoryPath, "fullparty-discord-bot-console-2026-05-31.jsonl"),
      `${JSON.stringify({
        level: "warn",
        message: "retained yesterday",
        timestamp: "2026-05-31T23:59:00.000Z",
      })}\n`,
    );
    await writeFile(
      join(directoryPath, "fullparty-discord-bot-console-2026-06-01.jsonl"),
      `${JSON.stringify({
        level: "error",
        message: "retained today",
        timestamp: "2026-06-01T00:01:00.000Z",
      })}\n`,
    );

    buffer.configureFilePersistence({
      directoryPath,
      now: new Date("2026-06-01T10:00:00.000Z"),
      retentionDays: 2,
    });

    expect(buffer.getEntries()).toMatchObject([
      { level: "error", message: "retained today" },
      { level: "warn", message: "retained yesterday" },
    ]);
    await expect(readDirectoryNames(directoryPath)).resolves.toEqual([
      "fullparty-discord-bot-console-2026-05-31.jsonl",
      "fullparty-discord-bot-console-2026-06-01.jsonl",
    ]);
  });

  it("purges expired files when logging crosses into a new day", async () => {
    const directoryPath = await createTempDir(tempDirs);
    const buffer = createRuntimeLogBuffer({ maxLines: 10 });

    await writeFile(
      join(directoryPath, "fullparty-discord-bot-console-2026-05-31.jsonl"),
      `${JSON.stringify({
        level: "info",
        message: "expires tomorrow",
        timestamp: "2026-05-31T23:59:00.000Z",
      })}\n`,
    );

    buffer.configureFilePersistence({
      directoryPath,
      now: new Date("2026-06-01T10:00:00.000Z"),
      retentionDays: 2,
    });
    buffer.append("info", "new day", new Date("2026-06-02T00:01:00.000Z"));

    await expect(readDirectoryNames(directoryPath)).resolves.toEqual([
      "fullparty-discord-bot-console-2026-06-02.jsonl",
    ]);
  });
});

async function createTempDir(tempDirs: string[]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "fullparty-runtime-logs-"));

  tempDirs.push(directory);

  return directory;
}

async function readJsonlFile(filePath: string): Promise<unknown[]> {
  const contents = await readFile(filePath, "utf8");

  return contents
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}

async function readDirectoryNames(directoryPath: string): Promise<string[]> {
  return (await readdir(directoryPath)).sort();
}
