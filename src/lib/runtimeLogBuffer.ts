import { appendFileSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";

export type RuntimeLogLevel = "debug" | "error" | "info" | "log" | "warn";

export type RuntimeLogEntry = {
  id: number;
  level: RuntimeLogLevel;
  message: string;
  timestamp: string;
};

export type RuntimeLogBuffer = {
  append(level: RuntimeLogLevel, message: string, timestamp?: Date): void;
  configureFilePersistence(options: RuntimeLogPersistenceOptions): void;
  getEntries(limit?: number): RuntimeLogEntry[];
  getMaxLines(): number;
  getPersistenceInfo(): RuntimeLogPersistenceInfo;
  getTotalBuffered(): number;
};

export type RuntimeLogBufferOptions = {
  maxLines?: number | undefined;
};

export type RuntimeLogPersistenceInfo = {
  directoryPath: string | null;
  enabled: boolean;
  retentionDays: number | null;
};

export type RuntimeLogPersistenceOptions = {
  directoryPath: string;
  now?: Date | undefined;
  retentionDays?: number | undefined;
};

type RuntimeLogPersistence = {
  directoryPath: string;
  lastPurgeDate: string;
  retentionDays: number;
};

type PersistedRuntimeLogEntry = {
  level: RuntimeLogLevel;
  message: string;
  timestamp: string;
};

const logFilePrefix = "fullparty-discord-bot-console";
const logFileExtension = ".jsonl";
const logFilePattern = /^fullparty-discord-bot-console-(\d{4}-\d{2}-\d{2})\.jsonl$/u;

export function createRuntimeLogBuffer(
  options: RuntimeLogBufferOptions = {},
): RuntimeLogBuffer {
  const maxLines = Math.max(1, Math.floor(options.maxLines ?? 10_000));
  const entries: RuntimeLogEntry[] = [];
  let nextId = 1;
  let persistence: RuntimeLogPersistence | undefined;

  return {
    append(level, message, timestamp = new Date()) {
      const lines = splitLines(message);

      for (const line of lines) {
        const entry = {
          id: nextId,
          level,
          message: line,
          timestamp: timestamp.toISOString(),
        };

        entries.push(entry);
        writePersistedEntry(persistence, entry);
        nextId += 1;
      }

      if (entries.length > maxLines) {
        entries.splice(0, entries.length - maxLines);
      }
    },
    configureFilePersistence({ directoryPath, now = new Date(), retentionDays = 30 }) {
      const safeRetentionDays = Math.max(1, Math.floor(retentionDays));
      const nextPersistence = {
        directoryPath,
        lastPurgeDate: formatUtcDate(now),
        retentionDays: safeRetentionDays,
      };
      const pendingEntries = entries.slice();

      mkdirSync(directoryPath, { recursive: true });
      purgeExpiredLogFiles(nextPersistence, now);

      const persistedEntries = readPersistedEntries(nextPersistence, maxLines);
      const mergedEntries = [...persistedEntries, ...pendingEntries].slice(-maxLines);

      entries.splice(0, entries.length, ...reindexEntries(mergedEntries));
      nextId = entries.length + 1;
      persistence = nextPersistence;

      for (const entry of pendingEntries) {
        writePersistedEntry(persistence, entry);
      }
    },
    getEntries(limit = maxLines) {
      const safeLimit = Math.max(1, Math.min(maxLines, Math.floor(limit)));

      return entries.slice(-safeLimit).reverse();
    },
    getMaxLines() {
      return maxLines;
    },
    getPersistenceInfo() {
      return {
        directoryPath: persistence?.directoryPath ?? null,
        enabled: persistence !== undefined,
        retentionDays: persistence?.retentionDays ?? null,
      };
    },
    getTotalBuffered() {
      return entries.length;
    },
  };
}

export function installConsoleLogCapture(buffer: RuntimeLogBuffer): () => void {
  const originalConsole = {
    debug: console.debug.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
    log: console.log.bind(console),
    warn: console.warn.bind(console),
  };

  console.debug = (...args: unknown[]) => {
    buffer.append("debug", formatConsoleArgs(args));
    originalConsole.debug(...args);
  };
  console.error = (...args: unknown[]) => {
    buffer.append("error", formatConsoleArgs(args));
    originalConsole.error(...args);
  };
  console.info = (...args: unknown[]) => {
    buffer.append("info", formatConsoleArgs(args));
    originalConsole.info(...args);
  };
  console.log = (...args: unknown[]) => {
    buffer.append("log", formatConsoleArgs(args));
    originalConsole.log(...args);
  };
  console.warn = (...args: unknown[]) => {
    buffer.append("warn", formatConsoleArgs(args));
    originalConsole.warn(...args);
  };

  return () => {
    console.debug = originalConsole.debug;
    console.error = originalConsole.error;
    console.info = originalConsole.info;
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
  };
}

function splitLines(message: string): string[] {
  const lines = message.split(/\r?\n/u);

  if (lines.at(-1) === "") {
    lines.pop();
  }

  return lines.length > 0 ? lines : [""];
}

function reindexEntries(entries: RuntimeLogEntry[]): RuntimeLogEntry[] {
  return entries.map((entry, index) => ({
    ...entry,
    id: index + 1,
  }));
}

function writePersistedEntry(
  persistence: RuntimeLogPersistence | undefined,
  entry: PersistedRuntimeLogEntry,
): void {
  if (!persistence) {
    return;
  }

  const entryDate = entry.timestamp.slice(0, 10);

  if (persistence.lastPurgeDate !== entryDate) {
    purgeExpiredLogFiles(persistence, new Date(entry.timestamp));
    persistence.lastPurgeDate = entryDate;
  }

  const filePath = getLogFilePath(persistence.directoryPath, entry.timestamp);

  appendFileSync(filePath, `${safeStringify(entry)}\n`, "utf8");
}

function readPersistedEntries(
  persistence: RuntimeLogPersistence,
  maxLines: number,
): RuntimeLogEntry[] {
  const loaded: RuntimeLogEntry[] = [];

  for (const filePath of getLogFilePathsNewestFirst(persistence.directoryPath)) {
    const lines = readFileSync(filePath, "utf8").split(/\r?\n/u);

    for (
      let index = lines.length - 1;
      index >= 0 && loaded.length < maxLines;
      index -= 1
    ) {
      const line = lines[index];

      if (!line) {
        continue;
      }

      const entry = parsePersistedEntry(line);

      if (entry) {
        loaded.push({
          ...entry,
          id: 0,
        });
      }
    }

    if (loaded.length >= maxLines) {
      break;
    }
  }

  return loaded.reverse();
}

function parsePersistedEntry(line: string): PersistedRuntimeLogEntry | null {
  try {
    const value = JSON.parse(line) as Partial<PersistedRuntimeLogEntry>;

    if (
      isRuntimeLogLevel(value.level) &&
      typeof value.message === "string" &&
      typeof value.timestamp === "string"
    ) {
      return {
        level: value.level,
        message: value.message,
        timestamp: value.timestamp,
      };
    }
  } catch {
    return null;
  }

  return null;
}

function purgeExpiredLogFiles(persistence: RuntimeLogPersistence, now: Date): void {
  const cutoff = formatUtcDate(
    new Date(startOfUtcDay(now).getTime() - (persistence.retentionDays - 1) * 86_400_000),
  );

  for (const filePath of getRuntimeLogFilePaths(persistence.directoryPath)) {
    const fileDate = getLogFileDate(filePath);

    if (fileDate && fileDate < cutoff) {
      rmSync(filePath, { force: true });
    }
  }
}

function getLogFilePathsNewestFirst(directoryPath: string): string[] {
  return getRuntimeLogFilePaths(directoryPath).sort((left, right) =>
    basename(right).localeCompare(basename(left)),
  );
}

function getRuntimeLogFilePaths(directoryPath: string): string[] {
  return readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && logFilePattern.test(entry.name))
    .map((entry) => join(directoryPath, entry.name));
}

function getLogFilePath(directoryPath: string, timestamp: string): string {
  return join(
    directoryPath,
    `${logFilePrefix}-${timestamp.slice(0, 10)}${logFileExtension}`,
  );
}

function getLogFileDate(filePath: string): string | null {
  return logFilePattern.exec(basename(filePath))?.[1] ?? null;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isRuntimeLogLevel(value: unknown): value is RuntimeLogLevel {
  return (
    value === "debug" ||
    value === "error" ||
    value === "info" ||
    value === "log" ||
    value === "warn"
  );
}

function formatConsoleArgs(args: unknown[]): string {
  return args.map(formatConsoleValue).join(" ");
}

function formatConsoleValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }

  try {
    return JSON.stringify(value, createJsonReplacer());
  } catch {
    return String(value);
  }
}

function createJsonReplacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet();

  return (_key, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }

    if (typeof value !== "object" || value === null) {
      return value;
    }

    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);

    return value;
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({
      level: "error",
      message: "Unable to serialize runtime log entry.",
      timestamp: new Date().toISOString(),
    });
  }
}
