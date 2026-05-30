import type { LatestPayloadStore } from "../payloads/latestPayloadStore.js";
import { FullpartyApiError } from "./client.js";

type CaptureFullpartyCommandPayloadOptions<TResponse> = {
  commandName: string;
  discordGuildId?: string;
  discordUserId?: string;
  payloads: LatestPayloadStore;
  request: () => Promise<TResponse>;
};

export async function captureFullpartyCommandPayload<TResponse>(
  options: CaptureFullpartyCommandPayloadOptions<TResponse>,
): Promise<TResponse> {
  try {
    const response = await options.request();

    options.payloads.set(
      {
        command: options.commandName,
        ...getDiscordSubjectPayload(options),
        ok: true,
        response,
        source: "fullparty.api",
      },
      `FullParty /${options.commandName} API response`,
    );

    return response;
  } catch (error) {
    options.payloads.set(
      {
        command: options.commandName,
        ...getDiscordSubjectPayload(options),
        error: serializeCommandError(error),
        ok: false,
        source: "fullparty.api",
      },
      `FullParty /${options.commandName} API error`,
    );

    throw error;
  }
}

function getDiscordSubjectPayload(
  options: Pick<
    CaptureFullpartyCommandPayloadOptions<unknown>,
    "discordGuildId" | "discordUserId"
  >,
): Record<string, string> {
  return {
    ...(options.discordGuildId ? { discord_guild_id: options.discordGuildId } : {}),
    ...(options.discordUserId ? { discord_user_id: options.discordUserId } : {}),
  };
}

function serializeCommandError(error: unknown): Record<string, unknown> {
  if (error instanceof FullpartyApiError) {
    return {
      body: error.body,
      message: error.message,
      name: error.name,
      status: error.status,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    };
  }

  return {
    value: error,
  };
}
