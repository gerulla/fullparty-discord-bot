import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminApiClient } from "../ui/src/api/adminApiClient.js";

describe("admin API client", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const logs = {
    data: [{ id: 1, level: "info", message: "Ready", timestamp: "2026-06-01T00:00:00Z" }],
    meta: { limit: 10000, maxLines: 10000, totalBuffered: 1 },
  };

  it("does not invoke native browser fetch with the client as its receiver", async () => {
    vi.stubGlobal("fetch", function (this: unknown) {
      expect(this instanceof AdminApiClient).toBe(false);
      return Promise.resolve(Response.json(logs));
    });
    await expect(new AdminApiClient().getLogs("token")).resolves.toEqual(logs);
  });

  it("sends a bearer token and validates the response", async () => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(logs)));
    await expect(new AdminApiClient(fetcher).getLogs("test-token")).resolves.toEqual(
      logs,
    );
    expect(fetcher).toHaveBeenCalledWith(
      "/admin/api/logs?limit=10000",
      expect.objectContaining({
        method: "GET",
        redirect: "error",
        headers: { accept: "application/json", authorization: "Bearer test-token" },
      }),
    );
  });

  it("rejects invalid API contracts before passing them to Vue", async () => {
    const api = new AdminApiClient(() =>
      Promise.resolve(Response.json({ data: [{ message: 42 }] })),
    );
    await expect(api.getLogs("token")).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("returns a useful authentication error", async () => {
    const api = new AdminApiClient(() =>
      Promise.resolve(new Response(null, { status: 401 })),
    );
    await expect(api.getDashboard("expired")).rejects.toMatchObject({
      status: 401,
      message: "Invalid or expired token. Please log in again.",
    });
  });

  it("aborts a hanging request and cleans up its timer", async () => {
    vi.useFakeTimers();
    const api = new AdminApiClient(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
      100,
    );
    const assertion = expect(api.getLogs("token")).rejects.toMatchObject({
      code: "request_aborted",
    });
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});
