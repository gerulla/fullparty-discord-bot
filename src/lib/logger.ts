import { serializeLogValue } from "./serialization.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type Logger = {
  debug(message: string, meta?: LogMetadata): void;
  error(message: string, meta?: LogMetadata): void;
  info(message: string, meta?: LogMetadata): void;
  warn(message: string, meta?: LogMetadata): void;
};

export type LogMetadata = Error | Record<string, unknown>;

const levelRank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createLogger(minimumLevel: LogLevel = "info"): Logger {
  const shouldWrite = (level: LogLevel) => levelRank[level] >= levelRank[minimumLevel];

  const write = (level: LogLevel, message: string, meta?: LogMetadata) => {
    if (!shouldWrite(level)) {
      return;
    }

    const entry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...(meta instanceof Error
        ? { error: serializeLogValue(meta) }
        : meta
          ? { meta: serializeLogValue(meta) }
          : {}),
    };

    const output = JSON.stringify(entry);

    if (level === "error") {
      console.error(output);
      return;
    }

    if (level === "warn") {
      console.warn(output);
      return;
    }

    console.log(output);
  };

  return {
    debug: (message, meta) => {
      write("debug", message, meta);
    },
    error: (message, meta) => {
      write("error", message, meta);
    },
    info: (message, meta) => {
      write("info", message, meta);
    },
    warn: (message, meta) => {
      write("warn", message, meta);
    },
  };
}
