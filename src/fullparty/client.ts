import { z } from "zod";
import { readResourceAsset, ResourceAssetError } from "./resources/assetDownload.js";
import type { ResourceAsset } from "./resources/schemas.js";

export type FullpartyApiClientOptions = {
  apiToken?: string;
  baseUrl: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

const healthResponseSchema = z.looseObject({
  checkedAt: z.string().optional(),
  status: z.string().optional(),
  version: z.string().optional(),
});
export type FullpartyHealthResponse = z.infer<typeof healthResponseSchema>;

export type FullpartyDiscordUserApplicationsResponse = unknown;
export type FullpartyDiscordGuildLinkRequest = {
  discordGuildId: string;
  iconUrl?: string | null;
  name: string;
  permissions: string;
  token: string;
};
export type FullpartyDiscordGuildLinkResponse = unknown;
export type FullpartyDiscordGuildRunRoleAssignmentResponse = unknown;
export type FullpartyDiscordGuildUpcomingRunsOptions = {
  limit?: number | undefined;
};
export type FullpartyDiscordGuildUpcomingRunsResponse = unknown;
export type FullpartyDiscordUserLinkRequest = {
  avatarUrl?: string;
  discordUserId: string;
  globalName?: string;
  token: string;
  username?: string;
};
export type FullpartyDiscordUserLinkResponse = unknown;
export type FullpartyDiscordUserUpcomingRunsResponse = unknown;

export class FullpartyApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "FullpartyApiError";
  }
}

export class FullpartyApiClient {
  private readonly apiToken: string | undefined;
  private readonly baseUrl: URL;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  public constructor(options: FullpartyApiClientOptions) {
    this.apiToken = options.apiToken;
    this.baseUrl = new URL(ensureTrailingSlash(options.baseUrl));
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  public async health(): Promise<FullpartyHealthResponse | undefined> {
    const response = await this.request("health");
    return response === undefined ? undefined : healthResponseSchema.parse(response);
  }

  public async getDiscordUserApplications(
    discordId: string,
  ): Promise<FullpartyDiscordUserApplicationsResponse> {
    return this.request(
      `integrations/discord-users/${encodeURIComponent(discordId)}/applications`,
    );
  }

  public async getDiscordUserUpcomingRuns(
    discordId: string,
  ): Promise<FullpartyDiscordUserUpcomingRunsResponse> {
    return this.request(
      `integrations/discord-users/${encodeURIComponent(discordId)}/upcoming-runs`,
    );
  }

  public async getDiscordGuildUpcomingRuns(
    discordGuildId: string,
    options: FullpartyDiscordGuildUpcomingRunsOptions = {},
  ): Promise<FullpartyDiscordGuildUpcomingRunsResponse> {
    const path = `integrations/discord-guilds/${encodeURIComponent(discordGuildId)}/upcoming-runs`;
    const searchParams = new URLSearchParams();

    if (typeof options.limit === "number") {
      searchParams.set("limit", String(options.limit));
    }

    return this.request(
      searchParams.size > 0 ? `${path}?${searchParams.toString()}` : path,
    );
  }

  public async getDiscordGuildRunRoleAssignment(
    discordGuildId: string,
    runId: number,
  ): Promise<FullpartyDiscordGuildRunRoleAssignmentResponse> {
    return this.request(
      `integrations/discord-guilds/${encodeURIComponent(discordGuildId)}/runs/${encodeURIComponent(String(runId))}/role-assignment`,
    );
  }

  public async linkDiscordUser(
    request: FullpartyDiscordUserLinkRequest,
  ): Promise<FullpartyDiscordUserLinkResponse> {
    return this.request("integrations/discord-users/link", {
      body: JSON.stringify({
        ...(request.avatarUrl ? { avatar_url: request.avatarUrl } : {}),
        discord_user_id: request.discordUserId,
        ...(request.globalName ? { global_name: request.globalName } : {}),
        token: request.token,
        ...(request.username ? { username: request.username } : {}),
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });
  }

  public listDiscordGuildResources(
    discordGuildId: string,
    page = 1,
    perPage = 25,
  ): Promise<unknown> {
    return this.request("integrations/resources/list", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ discord_guild_id: discordGuildId, page, per_page: perPage }),
    });
  }

  public getDiscordGuildResource(
    discordGuildId: string,
    commandName: string,
    page = 1,
    perPage = 25,
  ): Promise<unknown> {
    if (!commandName.trim() || commandName === "." || commandName === "..") {
      throw new Error("Invalid resource command name.");
    }
    return this.request(`integrations/resources/${encodeURIComponent(commandName)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ discord_guild_id: discordGuildId, page, per_page: perPage }),
    });
  }

  public getDiscordGuildResourceAsset(
    discordGuildId: string,
    commandName: string,
    asset: ResourceAsset,
    maxBytes: number,
  ): Promise<Buffer> {
    const url = new URL(asset.url);
    const expected = new URL(
      `integrations/discord-guilds/${encodeURIComponent(discordGuildId)}/resource-commands/${encodeURIComponent(commandName)}/assets/${encodeURIComponent(asset.id)}`,
      this.baseUrl,
    );
    if (
      url.origin !== expected.origin ||
      url.pathname !== expected.pathname ||
      url.username ||
      url.password ||
      url.hash
    ) {
      throw new ResourceAssetError(
        "Resource asset URL is not the matching FullParty API endpoint.",
        "unsafe_resource_asset",
      );
    }
    return this.requestUrl(
      url,
      { method: "GET", headers: { accept: asset.mime_type } },
      (response) => readResourceAsset(response, maxBytes),
    );
  }

  public async linkDiscordGuild(
    request: FullpartyDiscordGuildLinkRequest,
  ): Promise<FullpartyDiscordGuildLinkResponse> {
    return this.request("integrations/discord-guilds/link", {
      body: JSON.stringify({
        discord_guild_id: request.discordGuildId,
        icon_url: request.iconUrl ?? null,
        name: request.name,
        permissions: request.permissions,
        token: request.token,
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const url = new URL(stripLeadingSlash(path), this.baseUrl);
    return this.requestUrl(url, init, async (response) => {
      if (response.status === 204) return undefined;
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        throw new FullpartyTransportError(
          `Expected JSON from Fullparty API, received ${contentType}`,
          "invalid_response",
        );
      }
      return await response.json();
    });
  }

  private async requestUrl<T>(
    url: URL,
    init: RequestInit,
    read: (response: Response) => Promise<T>,
  ): Promise<T> {
    const headers = new Headers(init.headers);

    if (!headers.has("accept")) headers.set("accept", "application/json");

    if (this.apiToken) {
      headers.set("authorization", `Bearer ${this.apiToken}`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);
    try {
      const response = await this.fetcher(url, {
        ...init,
        headers,
        redirect: "error",
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new FullpartyApiError(
          `Fullparty API request failed with status ${String(response.status)}`,
          response.status,
          await readResponseBody(response),
        );
      }

      return await read(response);
    } catch (error) {
      if (
        error instanceof FullpartyApiError ||
        error instanceof FullpartyTransportError ||
        error instanceof ResourceAssetError
      )
        throw error;
      throw new FullpartyTransportError(
        controller.signal.aborted
          ? "FullParty API request timed out."
          : error instanceof SyntaxError
            ? "FullParty API returned malformed JSON."
            : "Unable to reach the FullParty API.",
        controller.signal.aborted
          ? "timeout"
          : error instanceof SyntaxError
            ? "invalid_response"
            : "network_error",
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class FullpartyTransportError extends Error {
  public constructor(
    message: string,
    public readonly code: "timeout" | "network_error" | "invalid_response",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "FullpartyTransportError";
  }
}

export type FullpartyApi = Pick<
  FullpartyApiClient,
  | "health"
  | "getDiscordUserApplications"
  | "getDiscordUserUpcomingRuns"
  | "getDiscordGuildUpcomingRuns"
  | "getDiscordGuildRunRoleAssignment"
  | "linkDiscordUser"
  | "linkDiscordGuild"
  | "listDiscordGuildResources"
  | "getDiscordGuildResource"
  | "getDiscordGuildResourceAsset"
>;

async function readResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const text = await response.text();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  return response.text();
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function stripLeadingSlash(value: string): string {
  return value.startsWith("/") ? value.slice(1) : value;
}
