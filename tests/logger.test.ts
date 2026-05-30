import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "../src/lib/logger.js";

type LogEntry = {
  error?: {
    message: string;
    name: string;
  };
  level: string;
  message: string;
  meta?: Record<string, unknown>;
};

describe("createLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("filters logs below the configured level", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warnSpy = spyConsole("warn");
    const logger = createLogger("warn");

    logger.info("hidden");
    logger.warn("visible");

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy.spy).toHaveBeenCalledTimes(1);
    expect(readLogEntry(warnSpy.calls).message).toBe("visible");
  });

  it("serializes metadata", () => {
    const logSpy = spyConsole("log");
    const logger = createLogger("debug");

    logger.debug("with metadata", { requestId: "request-1" });

    expect(readLogEntry(logSpy.calls)).toMatchObject({
      level: "debug",
      message: "with metadata",
      meta: { requestId: "request-1" },
    });
  });

  it("serializes errors to stderr", () => {
    const errorSpy = spyConsole("error");
    const logger = createLogger("debug");

    logger.error("failed", new Error("boom"));

    expect(readLogEntry(errorSpy.calls)).toMatchObject({
      error: {
        message: "boom",
        name: "Error",
      },
      level: "error",
      message: "failed",
    });
  });
});

type ConsoleMethod = "error" | "log" | "warn";
type ConsoleCall = [unknown, ...unknown[]];

function spyConsole(method: ConsoleMethod): {
  calls: ConsoleCall[];
  spy: ReturnType<typeof vi.spyOn>;
} {
  const calls: ConsoleCall[] = [];
  const spy = vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
    calls.push(toConsoleCall(args));
  });

  return { calls, spy };
}

function readLogEntry(calls: ConsoleCall[]): LogEntry {
  const call = calls.at(0);

  expect(call).toBeDefined();

  if (!call) {
    throw new Error("Expected console method to be called.");
  }

  return JSON.parse(String(call[0])) as LogEntry;
}

function toConsoleCall(args: unknown[]): ConsoleCall {
  return [args[0], ...args.slice(1)];
}
