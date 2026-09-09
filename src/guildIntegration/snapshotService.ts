import { z } from "zod";
import { createDiscordGuildSnapshot } from "../guildAutomation/guildSnapshot.js";
import type { GuildMemberCacheSnapshot } from "../guildMembership/memberCacheStore.js";
import { guildMembershipSnapshotRequestedDataSchema } from "../http/eventSchemas.js";
import type { ActionResult } from "../http/types.js";
import { markGuildLinked } from "./settingsService.js";
import type { GuildIntegrationOptions } from "./types.js";

export async function createGuildSnapshotResult(
  options: GuildIntegrationOptions,
  discordGuildId: string,
): Promise<ActionResult> {
  await markGuildLinked(options, discordGuildId);
  const snapshot = await createDiscordGuildSnapshot(
    options.client,
    options.context,
    discordGuildId,
  );
  const membershipCache = options.context.guildMemberCache
    ? serializeGuildMemberCacheSnapshot(
        await options.context.guildMemberCache.getSnapshot(discordGuildId, {
          includeUserIds: false,
        }),
      )
    : {
        configured: false,
      };

  return {
    channelCount: snapshot.channels.length,
    discordGuildId: snapshot.discord_guild_id,
    memberCount: snapshot.member_count,
    membershipCache,
    roleCount: snapshot.roles.length,
    snapshot,
  };
}

export async function createGuildMembershipSnapshotResult(
  options: GuildIntegrationOptions,
  data: z.infer<typeof guildMembershipSnapshotRequestedDataSchema>,
): Promise<ActionResult> {
  if (!options.context.guildMemberCache) {
    return {
      configured: false,
      discordGuildId: data.discord_guild_id,
      linked: false,
      membershipCache: null,
      refreshQueued: false,
    };
  }

  const settings = await options.context.guildSettings.get(data.discord_guild_id);

  if (!settings.linkedAt) {
    return {
      configured: true,
      discordGuildId: data.discord_guild_id,
      linked: false,
      membershipCache: null,
      refreshQueued: false,
    };
  }

  const includeUserIds = data.include_member_ids ?? true;
  const requestRefreshIfStale = data.request_refresh_if_stale ?? true;
  const snapshot = await options.context.guildMemberCache.getSnapshot(
    data.discord_guild_id,
    {
      includeUserIds,
    },
  );
  const shouldQueueRefresh =
    requestRefreshIfStale && snapshot.refreshStatus !== "refreshing" && snapshot.stale;
  const refreshResult =
    shouldQueueRefresh && options.context.guildMemberCacheScheduler
      ? await options.context.guildMemberCacheScheduler.enqueueRefresh(
          data.discord_guild_id,
          "dashboard_request",
        )
      : undefined;

  return {
    configured: true,
    discordGuildId: data.discord_guild_id,
    linked: true,
    membershipCache: serializeGuildMemberCacheSnapshot(snapshot),
    refreshQueued: refreshResult?.queued ?? false,
    ...(refreshResult
      ? {
          refreshAlreadyQueued: refreshResult.alreadyQueued,
          refreshReason: refreshResult.reason,
        }
      : {}),
  };
}

export function serializeGuildMemberCacheSnapshot(snapshot: GuildMemberCacheSnapshot): {
  cache_age_seconds: number | null;
  cached_member_count: number;
  discord_member_count: number | null;
  discord_guild_id: string;
  discord_user_ids?: string[];
  last_error: string | null;
  last_full_refresh_at: string | null;
  member_count: number;
  next_refresh_after: string | null;
  refresh_status: GuildMemberCacheSnapshot["refreshStatus"];
  stale: boolean;
  updated_at: string | null;
} {
  return {
    cache_age_seconds: snapshot.cacheAgeSeconds,
    cached_member_count: snapshot.cachedMemberCount,
    discord_member_count: snapshot.memberCount,
    discord_guild_id: snapshot.discordGuildId,
    ...(snapshot.discordUserIds ? { discord_user_ids: snapshot.discordUserIds } : {}),
    last_error: snapshot.lastError,
    last_full_refresh_at: snapshot.lastFullRefreshAt,
    member_count: snapshot.cachedMemberCount,
    next_refresh_after: snapshot.nextRefreshAfter,
    refresh_status: snapshot.refreshStatus,
    stale: snapshot.stale,
    updated_at: snapshot.updatedAt,
  };
}
