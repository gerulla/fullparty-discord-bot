import type { FullpartyApiClient } from "../fullparty/client.js";
import type { GuildSettingsStore } from "../guildSettings/store.js";
import type { Logger } from "../lib/logger.js";
import type { LatestPayloadStore } from "../payloads/latestPayloadStore.js";

export type BotContext = {
  fullparty: FullpartyApiClient;
  fullpartyWebBaseUrl: string;
  guildSettings: GuildSettingsStore;
  logger: Logger;
  payloads: LatestPayloadStore;
};
