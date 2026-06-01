import type { FullpartyApiClient } from "../fullparty/client.js";
import type { UserDmRateLimiter } from "../dm/userDmRateLimiter.js";
import type { GuildRunRoleStore } from "../guildAutomation/runRoleStore.js";
import type { GuildRunReminderQueue } from "../guildAutomation/runReminderQueue.js";
import type { GuildMemberCacheScheduler } from "../guildMembership/memberCacheScheduler.js";
import type { GuildMemberCacheStore } from "../guildMembership/memberCacheStore.js";
import type { GuildSettingsStore } from "../guildSettings/store.js";
import type { FailureReporter } from "../health/failureReporter.js";
import type { Logger } from "../lib/logger.js";
import type { LatestPayloadStore } from "../payloads/latestPayloadStore.js";

export type BotContext = {
  failureReporter?: FailureReporter | undefined;
  fullparty: FullpartyApiClient;
  fullpartyWebBaseUrl: string;
  guildMemberCache?: GuildMemberCacheStore | undefined;
  guildMemberCacheScheduler?: GuildMemberCacheScheduler | undefined;
  guildRunRoles?: GuildRunRoleStore | undefined;
  guildRunReminderQueue?: GuildRunReminderQueue | undefined;
  guildSettings: GuildSettingsStore;
  logger: Logger;
  payloadCommandAllowedUserId?: string | undefined;
  payloads: LatestPayloadStore;
  userDmRateLimiter?: UserDmRateLimiter | undefined;
};
