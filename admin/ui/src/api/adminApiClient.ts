import type { z } from "zod";
import {
  dashboardResponseSchema,
  memberCacheRefreshResponseSchema,
  runtimeLogsResponseSchema,
} from "../../../src/shared/schemas.js";

export class AdminApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AdminApiError";
  }
}

export class AdminApiClient {
  public constructor(
    private readonly fetcher: typeof fetch = (...args) => fetch(...args),
    private readonly timeoutMs = 15_000,
  ) {}

  public getDashboard(token: string, signal?: AbortSignal) {
    return this.request("metrics", token, dashboardResponseSchema, "GET", signal);
  }

  public getLogs(token: string, signal?: AbortSignal) {
    return this.request(
      "logs?limit=10000",
      token,
      runtimeLogsResponseSchema,
      "GET",
      signal,
    );
  }

  public refreshMemberCache(token: string, signal?: AbortSignal) {
    return this.request(
      "guild-member-cache/refresh",
      token,
      memberCacheRefreshResponseSchema,
      "POST",
      signal,
    );
  }

  private async request<T>(
    path: string,
    token: string,
    schema: z.ZodType<T>,
    method: "GET" | "POST",
    signal?: AbortSignal,
  ): Promise<T> {
    const controller = new AbortController();
    const abort = () => {
      controller.abort();
    };
    const timeout = setTimeout(abort, this.timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    try {
      const response = await this.fetcher(`/admin/api/${path}`, {
        headers: { accept: "application/json", authorization: `Bearer ${token}` },
        method,
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.ok) {
        throw new AdminApiError(
          response.status === 401
            ? "Invalid or expired token. Please log in again."
            : `Admin API request failed (${String(response.status)}).`,
          response.status,
          "request_failed",
        );
      }
      const body: unknown = await response.json();
      const result = schema.safeParse(body);
      if (!result.success)
        throw new AdminApiError(
          "The admin API returned an invalid response.",
          response.status,
          "invalid_response",
          { cause: result.error },
        );
      return result.data;
    } catch (error) {
      if (error instanceof AdminApiError) throw error;
      throw new AdminApiError(
        controller.signal.aborted
          ? "The admin request timed out or was cancelled."
          : "Unable to reach the admin API.",
        0,
        controller.signal.aborted ? "request_aborted" : "network_error",
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
}
