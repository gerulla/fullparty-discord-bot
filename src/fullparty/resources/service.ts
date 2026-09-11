import { CommandError } from "../../commands/commandError.js";
import {
  FullpartyApiError,
  FullpartyTransportError,
  type FullpartyApi,
} from "../client.js";
import {
  resourceListResponseSchema,
  resourceLookupResponseSchema,
  type ResourceData,
  type ResourceListResponse,
  type ResourceLookupResponse,
} from "./schemas.js";
import { ResourceAssetError } from "./assetDownload.js";

type ResourceApi = Pick<
  FullpartyApi,
  "listDiscordGuildResources" | "getDiscordGuildResource" | "getDiscordGuildResourceAsset"
>;

// Ten entries leave room for long command names and titles in one Discord embed.
export const resourcePageSize = 10;

export class GuildResourceService {
  public constructor(private readonly api: ResourceApi) {}

  public async list(guildId: string, page = 1): Promise<ResourceListResponse> {
    try {
      const result = resourceListResponseSchema.safeParse(
        await this.api.listDiscordGuildResources(guildId, page, resourcePageSize),
      );
      if (!result.success) throw invalidResponse(result.error);
      validatePagination(result.data, guildId, page);
      return result.data;
    } catch (error) {
      throw resourceRequestError(error, "list");
    }
  }

  public async lookup(
    guildId: string,
    commandName: string,
    page = 1,
  ): Promise<ResourceLookupResponse> {
    try {
      const result = resourceLookupResponseSchema.safeParse(
        await this.api.getDiscordGuildResource(
          guildId,
          commandName,
          page,
          resourcePageSize,
        ),
      );
      if (!result.success) throw invalidResponse(result.error);
      if (!result.data.found) {
        validatePagination(result.data, guildId, page);
      } else if (
        result.data.data.command_name.toLowerCase() !== commandName.toLowerCase()
      ) {
        throw invalidResponse(
          new Error("Resource command name did not match the request."),
        );
      }
      return result.data;
    } catch (error) {
      throw resourceRequestError(error, "embed");
    }
  }

  public async downloadAssets(
    guildId: string,
    resource: ResourceData,
    uploadLimit: number,
  ): Promise<{ attachment: Buffer; name: string }[]> {
    const files: { attachment: Buffer; name: string }[] = [];
    const filenames = new Set(resource.assets.map((asset) => asset.filename));
    if (filenames.size !== resource.assets.length)
      throw invalidResponse(new Error("Duplicate attachment filenames."));
    for (const url of [resource.embed.image?.url, resource.embed.thumbnail?.url]) {
      if (
        url?.startsWith("attachment://") &&
        !filenames.has(url.slice("attachment://".length))
      ) {
        throw invalidResponse(
          new Error("Embed references an attachment that is missing from assets."),
        );
      }
    }
    // Bound memory even when a boosted server advertises a much larger upload allowance.
    let remainingBytes = 25 * 1024 * 1024;
    const perFileLimit =
      Number.isFinite(uploadLimit) && uploadLimit > 0 ? uploadLimit : 10 * 1024 * 1024;
    try {
      for (const asset of resource.assets) {
        const bytes = await this.api.getDiscordGuildResourceAsset(
          guildId,
          resource.command_name,
          asset,
          Math.min(perFileLimit, remainingBytes),
        );
        remainingBytes -= bytes.length;
        files.push({ attachment: bytes, name: asset.filename });
      }
      return files;
    } catch (error) {
      throw resourceRequestError(error, "asset");
    }
  }
}

function validatePagination(
  result: ResourceListResponse,
  guildId: string,
  page: number,
): void {
  const { data, meta } = result;
  if (
    meta.discord_guild_id !== guildId ||
    meta.current_page !== page ||
    data.length > resourcePageSize ||
    data.length > meta.per_page ||
    data.length > meta.total ||
    (data.length > 0 && page > meta.last_page) ||
    (meta.next_page !== null &&
      (meta.next_page <= page || meta.next_page > meta.last_page))
  ) {
    throw invalidResponse(
      new Error("Resource pagination did not match the requested guild/page."),
    );
  }
}

export function invalidResponse(cause: unknown): CommandError {
  return new CommandError(
    "FullParty returned resource data I cannot display. Please let the FullParty team know.",
    "invalid_resource_response",
    true,
    { cause },
  );
}

function resourceRequestError(
  error: unknown,
  target: "list" | "embed" | "asset",
): unknown {
  if (error instanceof ResourceAssetError) {
    return new CommandError(
      error.code === "resource_asset_too_large"
        ? "This resource's attachments exceed the upload limit (25 MiB total, or this channel's per-file limit). Please ask the group to reduce their size."
        : "A resource attachment could not be loaded safely from FullParty. Please let the FullParty team know.",
      error.code,
      error.code !== "resource_asset_too_large",
      { cause: error },
    );
  }
  if (error instanceof FullpartyApiError) {
    const message =
      error.status === 404
        ? target === "asset"
          ? "A resource attachment was not found on FullParty. Please ask the group to update this resource."
          : target === "embed"
            ? "That resource was not found for this server. Use `/info` to see the available names."
            : "No resource list was found for this server. Check that the server is linked to the correct FullParty group."
        : error.status === 401 || error.status === 403
          ? "FullParty did not allow this resource request. Ask an admin to check the server link and the bot's integration API access."
          : error.status === 429
            ? "FullParty is receiving too many requests. Please try again shortly."
            : "I could not load resources from FullParty right now. Please try again shortly.";
    return new CommandError(
      message,
      `fullparty_api_${String(error.status)}`,
      error.status >= 500,
      { cause: error },
    );
  }
  if (error instanceof FullpartyTransportError) {
    return new CommandError(
      "I could not reach FullParty to load resources. Please try again shortly.",
      error.code,
      true,
      { cause: error },
    );
  }
  return error;
}
