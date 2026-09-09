import { describe, expect, it, vi } from "vitest";
import { runReportedTask } from "../src/health/errorReporter.js";
import type { FailureReporter } from "../src/health/failureReporter.js";
import { serializeLogValue } from "../src/lib/serialization.js";

describe("error reporting", () => {
  it.each([false, true])(
    "records synchronous and asynchronous failures (async=%s)",
    async (asyncFailure) => {
      const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const record = vi.fn<FailureReporter["record"]>((input) =>
        Promise.resolve({ ...input, id: 1, occurredAt: new Date().toISOString() }),
      );
      const reporter: FailureReporter = {
        record,
        getHealthSummary: () => {
          throw new Error("unused");
        },
      };
      const error = Object.assign(new Error("Missing Permissions"), { code: 50013 });
      await runReportedTask(
        { logger, failureReporter: reporter },
        { source: "discord_api", action: "role_assignment" },
        () => {
          if (asyncFailure) return Promise.reject(error);
          throw error;
        },
      );
      expect(record).toHaveBeenCalledTimes(1);
      expect(record.mock.calls[0]?.[0]).toMatchObject({
        affectsHealth: false,
        errorCode: "50013",
        action: "role_assignment",
        details: { error: { message: "Missing Permissions", code: 50013 } },
      });
    },
  );

  it("does not let a reporting failure escape the event boundary", async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const reporter: FailureReporter = {
      record: () => {
        throw new Error("database unavailable");
      },
      getHealthSummary: () => {
        throw new Error("unused");
      },
    };
    await expect(
      runReportedTask(
        { logger, failureReporter: reporter },
        { source: "runtime", action: "test" },
        () => {
          throw new Error("original");
        },
      ),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it("preserves nested errors and handles secrets, bigint, and circular metadata", () => {
    const meta: Record<string, unknown> = {
      error: Object.assign(new Error("outer", { cause: new Error("inner") }), {
        code: 50013,
        requestBody: { token: "secret" },
        url: "https://example.test/token",
      }),
      token: "secret",
      permissions: 42n,
    };
    meta.self = meta;
    const result = serializeLogValue(meta);
    expect(result).toMatchObject({
      error: { message: "outer", cause: { message: "inner" }, code: 50013 },
      token: "[Redacted]",
      permissions: "42",
      self: "[Circular]",
    });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("requestBody");
  });
});
