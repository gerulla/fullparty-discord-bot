import { afterEach, describe, expect, it, vi } from "vitest";
import { FullpartyApiClient } from "../src/fullparty/client.js";

describe("FullParty request failures", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts requests that do not finish within the deadline", async () => {
    vi.useFakeTimers();
    const fetcher: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    const client = new FullpartyApiClient({
      baseUrl: "https://fullparty.test/api/",
      fetcher,
      timeoutMs: 100,
    });
    const assertion = expect(
      client.getDiscordUserApplications("123"),
    ).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps HTTP status when an error response has malformed JSON", async () => {
    const client = new FullpartyApiClient({
      baseUrl: "https://fullparty.test/api/",
      fetcher: () =>
        Promise.resolve(
          new Response("broken", {
            status: 503,
            headers: { "content-type": "application/json" },
          }),
        ),
    });
    await expect(client.getDiscordUserApplications("123")).rejects.toMatchObject({
      status: 503,
      body: "broken",
    });
  });

  it("reports malformed successful responses distinctly from network failures", async () => {
    const client = new FullpartyApiClient({
      baseUrl: "https://fullparty.test/api/",
      fetcher: () =>
        Promise.resolve(
          new Response("broken", { headers: { "content-type": "application/json" } }),
        ),
    });
    await expect(client.getDiscordUserApplications("123")).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
});
