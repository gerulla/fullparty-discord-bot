import { z } from "zod";
import { serializeGuildSettings } from "../guildAutomation/guildSnapshot.js";
import type { GuildSettingsPatch } from "../guildSettings/types.js";
import { guildSettingsUpdatedDataSchema } from "../http/eventSchemas.js";
import type { ActionResult } from "../http/types.js";
import { hasOwn } from "../lib/valueReaders.js";
import type { GuildIntegrationOptions } from "./types.js";

export async function updateGuildSettingsFromFullparty(
  options: GuildIntegrationOptions,
  data: z.infer<typeof guildSettingsUpdatedDataSchema>,
): Promise<ActionResult> {
  const current = await options.context.guildSettings.get(data.discord_guild_id);
  const patch = createGuildSettingsPatch(data.settings);

  if (!current.linkedAt) {
    patch.linkedAt = new Date().toISOString();
  }

  const settings = await options.context.guildSettings.update(
    data.discord_guild_id,
    patch,
  );

  return {
    discordGuildId: data.discord_guild_id,
    settings: serializeGuildSettings(settings),
    updated: true,
  };
}

export async function markGuildLinked(
  options: GuildIntegrationOptions,
  discordGuildId: string,
): Promise<void> {
  const settings = await options.context.guildSettings.get(discordGuildId);

  if (settings.linkedAt) {
    return;
  }

  await options.context.guildSettings.update(discordGuildId, {
    linkedAt: new Date().toISOString(),
  });
}

function createGuildSettingsPatch(
  settings: GuildSettingsUpdatedSettings,
): GuildSettingsPatch {
  const patch: GuildSettingsPatch = {};

  setPatchId(settings, patch, "bot_log_channel_id", "botLogChannelId");
  setPatchId(settings, patch, "bot_moderator_role_id", "botModeratorRoleId");
  setPatchId(settings, patch, "run_announcement_channel_id", "runAnnouncementChannelId");
  setPatchId(settings, patch, "upcoming_raider_role_id", "upcomingRaiderRoleId");
  setPatchId(settings, patch, "schedule_refresh_channel_id", "scheduleRefreshChannelId");
  if (settings.schedule_refresh_enabled !== undefined)
    patch.scheduleRefreshEnabled = settings.schedule_refresh_enabled;
  if (settings.schedule_refresh_interval_days !== undefined)
    patch.scheduleRefreshIntervalDays = settings.schedule_refresh_interval_days;

  if (hasOwn(settings, "run_role_template_id")) {
    patch.upcomingRaiderRoleId = settings.run_role_template_id ?? null;
  }

  if (hasOwn(settings, "run_role_template_overrides")) {
    const overrides = settings.run_role_template_overrides ?? [];

    patch.runRoleTemplateOverrides = overrides.map((override) => ({
      activityId: override.activity_id,
      activityName: override.activity_name,
      ...(override.created_at ? { createdAt: override.created_at } : {}),
      roleId: override.role_id,
      ...(override.updated_at ? { updatedAt: override.updated_at } : {}),
    }));
  }

  if (
    typeof settings.sync_discord_names_to_ff14 === "boolean" &&
    hasOwn(settings, "sync_discord_names_to_ff14")
  ) {
    patch.syncDiscordNamesToFf14 = settings.sync_discord_names_to_ff14;
  }

  return patch;
}

type GuildSettingsUpdatedSettings = z.infer<
  typeof guildSettingsUpdatedDataSchema
>["settings"];

type GuildSettingsUpdatedIdKey =
  | "bot_log_channel_id"
  | "bot_moderator_role_id"
  | "run_announcement_channel_id"
  | "upcoming_raider_role_id"
  | "schedule_refresh_channel_id";

type GuildSettingsPatchIdKey = keyof Omit<
  GuildSettingsPatch,
  | "runRoleTemplateOverrides"
  | "syncDiscordNamesToFf14"
  | "scheduleRefreshEnabled"
  | "scheduleRefreshIntervalDays"
>;

function setPatchId(
  settings: GuildSettingsUpdatedSettings,
  patch: GuildSettingsPatch,
  sourceKey: GuildSettingsUpdatedIdKey,
  targetKey: GuildSettingsPatchIdKey,
): void {
  if (hasOwn(settings, sourceKey)) {
    const value = settings[sourceKey];

    patch[targetKey] = typeof value === "string" ? value : null;
  }
}
