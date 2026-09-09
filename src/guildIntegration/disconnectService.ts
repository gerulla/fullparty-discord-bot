import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  createDiscordGuildSnapshot,
  serializeGuildSettings,
} from "../guildAutomation/guildSnapshot.js";
import { serializeFailureError } from "../health/failureReporter.js";
import { guildDisconnectedDataSchema } from "../http/eventSchemas.js";
import type { ActionResult } from "../http/types.js";
import { serializeGuildMemberCacheSnapshot } from "./snapshotService.js";
import type { GuildIntegrationOptions } from "./types.js";

export async function disconnectGuildFromFullparty(
  options: GuildIntegrationOptions,
  data: z.infer<typeof guildDisconnectedDataSchema>,
): Promise<ActionResult> {
  const archivedAt = new Date();
  const archive = await createGuildDisconnectArchive(options, data, archivedAt);
  const archivePath = await writeGuildDisconnectArchive(data, archive);

  await options.context.guildSettings.update(data.discord_guild_id, {
    linkedAt: null,
    runRoleTemplateOverrides: [],
  });
  await options.context.guildMemberCache?.markGuildObsolete(
    data.discord_guild_id,
    archivedAt,
  );

  options.context.logger.info("FullParty guild disconnected.", {
    archivePath,
    discordGuildId: data.discord_guild_id,
    groupId: data.group_id,
    groupSlug: data.group_slug,
  });

  return {
    archived: true,
    archivePath,
    discordGuildId: data.discord_guild_id,
    groupId: data.group_id ?? null,
    groupSlug: data.group_slug ?? null,
    unlinked: true,
  };
}

async function createGuildDisconnectArchive(
  options: GuildIntegrationOptions,
  data: z.infer<typeof guildDisconnectedDataSchema>,
  archivedAt: Date,
): Promise<Record<string, unknown>> {
  const settings = await options.context.guildSettings.get(data.discord_guild_id);
  const membershipCache = options.context.guildMemberCache
    ? serializeGuildMemberCacheSnapshot(
        await options.context.guildMemberCache.getSnapshot(data.discord_guild_id, {
          includeUserIds: true,
        }),
      )
    : null;
  const runRoleMappings = options.context.guildRunRoles?.listByGuild
    ? await options.context.guildRunRoles.listByGuild(data.discord_guild_id)
    : null;
  const liveSnapshot = await createBestEffortLiveGuildSnapshot(options, data);

  return {
    archived_at: archivedAt.toISOString(),
    disconnected_event: data,
    discord_guild_id: data.discord_guild_id,
    group_id: data.group_id ?? null,
    group_name: data.group_name ?? null,
    group_slug: data.group_slug ?? null,
    local_data: {
      live_guild_snapshot: liveSnapshot,
      membership_cache: membershipCache,
      run_role_mappings: runRoleMappings,
      settings: serializeGuildSettings(settings),
    },
  };
}

async function createBestEffortLiveGuildSnapshot(
  options: GuildIntegrationOptions,
  data: z.infer<typeof guildDisconnectedDataSchema>,
): Promise<unknown> {
  try {
    return await createDiscordGuildSnapshot(
      options.client,
      options.context,
      data.discord_guild_id,
    );
  } catch (error) {
    return {
      error: serializeFailureError(error),
      unavailable: true,
    };
  }
}

async function writeGuildDisconnectArchive(
  data: z.infer<typeof guildDisconnectedDataSchema>,
  archive: Record<string, unknown>,
): Promise<string> {
  const directory = join(
    process.cwd(),
    "history",
    "groups",
    "unlinked",
    createGroupHistoryDirectoryName(data),
  );
  const archivePath = join(directory, "data.json");
  const temporaryArchivePath = join(directory, "data.json.tmp");

  await mkdir(directory, { recursive: true });
  await writeFile(temporaryArchivePath, `${JSON.stringify(archive, null, 2)}\n`, "utf8");
  await rename(temporaryArchivePath, archivePath);

  return archivePath;
}

function createGroupHistoryDirectoryName(
  data: z.infer<typeof guildDisconnectedDataSchema>,
): string {
  return sanitizeHistoryPathSegment(
    data.group_slug ??
      data.group_name ??
      (data.group_id ? `group-${String(data.group_id)}` : undefined) ??
      `discord-guild-${data.discord_guild_id}`,
  );
}

function sanitizeHistoryPathSegment(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 120);

  return sanitized.length > 0 ? sanitized : "unknown-group";
}
