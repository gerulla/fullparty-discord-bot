import { describe, expect, it, vi } from "vitest";
import { ApplicationResources } from "../src/application/resources.js";

describe("application resources", () => {
  it("closes in reverse order exactly once, continuing after a failure", async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const resources = new ApplicationResources(logger);
    const closed: string[] = [];
    resources.add("database", () => {
      closed.push("database");
    });
    resources.add("worker", () => {
      closed.push("worker");
      throw new Error("cleanup failed");
    });
    resources.add("http", () => {
      closed.push("http");
    });

    const first = resources.close();
    expect(resources.close()).toBe(first);
    await expect(first).rejects.toThrow(AggregateError);
    expect(closed).toEqual(["http", "worker", "database"]);
    expect(logger.error).toHaveBeenCalledWith(
      "Unable to close application resource.",
      expect.objectContaining({ resource: "worker" }),
    );
  });
});
