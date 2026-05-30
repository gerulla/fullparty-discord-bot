export type FullpartyApiClientOptions = {
  apiToken?: string;
  baseUrl: string;
  fetcher?: typeof fetch;
};

export type FullpartyHealthResponse = {
  checkedAt?: string;
  status?: string;
  version?: string;
  [key: string]: unknown;
};

export type FullpartyDiscordUserApplicationsResponse = unknown;
export type FullpartyDiscordGuildLinkRequest = {
  discordGuildId: string;
  iconUrl?: string;
  name: string;
  permissions: string;
  token: string;
};
export type FullpartyDiscordGuildLinkResponse = unknown;
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

  public constructor(options: FullpartyApiClientOptions) {
    this.apiToken = options.apiToken;
    this.baseUrl = new URL(ensureTrailingSlash(options.baseUrl));
    this.fetcher = options.fetcher ?? fetch;
  }

  public async health(): Promise<FullpartyHealthResponse> {
    return this.request<FullpartyHealthResponse>("health");
  }

  public async getDiscordUserApplications(
    discordId: string,
  ): Promise<FullpartyDiscordUserApplicationsResponse> {
    return this.request<FullpartyDiscordUserApplicationsResponse>(
      `integrations/discord-users/${encodeURIComponent(discordId)}/applications`,
    );
  }

  public async getDiscordUserUpcomingRuns(
    discordId: string,
  ): Promise<FullpartyDiscordUserUpcomingRunsResponse> {
    return this.request<FullpartyDiscordUserUpcomingRunsResponse>(
      `integrations/discord-users/${encodeURIComponent(discordId)}/upcoming-runs`,
    );
  }

  public async linkDiscordUser(
    request: FullpartyDiscordUserLinkRequest,
  ): Promise<FullpartyDiscordUserLinkResponse> {
    return this.request<FullpartyDiscordUserLinkResponse>(
      "integrations/discord-users/link",
      {
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
      },
    );
  }

  public async linkDiscordGuild(
    request: FullpartyDiscordGuildLinkRequest,
  ): Promise<FullpartyDiscordGuildLinkResponse> {
    return this.request<FullpartyDiscordGuildLinkResponse>(
      "integrations/discord-guilds/link",
      {
        body: JSON.stringify({
          discord_guild_id: request.discordGuildId,
          ...(request.iconUrl ? { icon_url: request.iconUrl } : {}),
          name: request.name,
          permissions: request.permissions,
          token: request.token,
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      },
    );
  }

  private async request<TResponse>(
    path: string,
    init: RequestInit = {},
  ): Promise<TResponse> {
    const url = new URL(stripLeadingSlash(path), this.baseUrl);
    const headers = new Headers(init.headers);

    headers.set("accept", "application/json");

    if (this.apiToken) {
      headers.set("authorization", `Bearer ${this.apiToken}`);
    }

    const response = await this.fetcher(url, {
      ...init,
      headers,
    });

    if (!response.ok) {
      throw new FullpartyApiError(
        `Fullparty API request failed with status ${String(response.status)}`,
        response.status,
        await readResponseBody(response),
      );
    }

    if (response.status === 204) {
      return undefined as TResponse;
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (!contentType.includes("application/json")) {
      throw new Error(`Expected JSON from Fullparty API, received ${contentType}`);
    }

    return (await response.json()) as TResponse;
  }
}

async function readResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function stripLeadingSlash(value: string): string {
  return value.startsWith("/") ? value.slice(1) : value;
}
