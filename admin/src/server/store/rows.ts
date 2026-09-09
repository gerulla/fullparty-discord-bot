import type {
  AdminAutomationRunRecord,
  AdminAutomationRunStatus,
  AdminAutomationRunType,
  AdminBotEventRecord,
  AdminBotEventStatus,
  AdminCommandUsageRecord,
  AdminCommandUsageStatus,
  AdminDmDeliveryRecord,
  AdminDmDeliveryStatus,
  AdminFailureRecord,
  AdminGuildMessageRecord,
  AdminGuildMessageStatus,
  AdminGuildRecord,
} from "../../shared/telemetry.js";
import { parseJsonField } from "./queryHelpers.js";

export type CountRow = {
  count: number;
};

export type StatusCountRow = {
  count: number;
  status: string;
};

export type LabeledCountRow = {
  count: number;
  label: string | null;
};

export type BucketCountRow = {
  bucket: string;
  count: number;
};

export type BotEventRow = {
  data_type: string | null;
  discord_guild_id: string | null;
  discord_user_id: string | null;
  error_code: string | null;
  event_type: string;
  id: number;
  occurred_at: string;
  request_host: string | null;
  request_id: string | null;
  status: AdminBotEventStatus;
};

export type DmDeliveryRow = {
  discord_user_id: string;
  error_code: string | null;
  error_message: string | null;
  event_type: string | null;
  id: number;
  message_id: string | null;
  notification_type: string | null;
  occurred_at: string;
  queued_at: string | null;
  sent_at: string | null;
  status: AdminDmDeliveryStatus;
};

export type CommandUsageRow = {
  command_name: string;
  discord_guild_id: string | null;
  discord_user_id: string | null;
  duration_ms: number | null;
  error_code: string | null;
  id: number;
  occurred_at: string;
  status: AdminCommandUsageStatus;
};

export type GuildMessageRow = {
  channel_id: string | null;
  discord_guild_id: string | null;
  error_code: string | null;
  error_message: string | null;
  id: number;
  message_id: string | null;
  message_type: string;
  occurred_at: string;
  status: AdminGuildMessageStatus;
};

export type AutomationRunRow = {
  automation_type: AdminAutomationRunType;
  discord_guild_id: string | null;
  duration_ms: number | null;
  event_type: string | null;
  failure_count: number;
  id: number;
  occurred_at: string;
  result_json: string | null;
  run_id: number | null;
  skipped_count: number;
  status: AdminAutomationRunStatus;
  success_count: number;
};

export type FailureRow = {
  action: string;
  affects_health: number;
  details_json: string | null;
  discord_guild_id: string | null;
  discord_user_id: string | null;
  error_code: string | null;
  event_type: string | null;
  id: number;
  message: string;
  occurred_at: string;
  run_id: number | null;
  severity: string;
  source: string;
};

export type GuildRow = {
  bot_log_channel_id: string | null;
  bot_moderator_role_id: string | null;
  bot_permissions: string | null;
  cached_member_count: number | null;
  discord_guild_id: string;
  last_error: string | null;
  last_full_refresh_at: string | null;
  last_seen_at: string | null;
  linked_at: string | null;
  member_count: number | null;
  name: string | null;
  next_refresh_after: string | null;
  refresh_status: string | null;
  run_announcement_channel_id: string | null;
  sync_discord_names_to_ff14: number | null;
  unavailable: number | null;
  upcoming_raider_role_id: string | null;
  updated_at: string | null;
};

export function rowToBotEvent(row: BotEventRow): AdminBotEventRecord {
  return {
    dataType: row.data_type,
    discordGuildId: row.discord_guild_id,
    discordUserId: row.discord_user_id,
    errorCode: row.error_code,
    eventType: row.event_type,
    id: row.id,
    occurredAt: row.occurred_at,
    requestHost: row.request_host,
    requestId: row.request_id,
    status: row.status,
  };
}

export function rowToDmDelivery(row: DmDeliveryRow): AdminDmDeliveryRecord {
  return {
    discordUserId: row.discord_user_id,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    eventType: row.event_type,
    id: row.id,
    messageId: row.message_id,
    notificationType: row.notification_type,
    occurredAt: row.occurred_at,
    queuedAt: row.queued_at,
    sentAt: row.sent_at,
    status: row.status,
  };
}

export function rowToCommandUsage(row: CommandUsageRow): AdminCommandUsageRecord {
  return {
    commandName: row.command_name,
    discordGuildId: row.discord_guild_id,
    discordUserId: row.discord_user_id,
    durationMs: row.duration_ms,
    errorCode: row.error_code,
    id: row.id,
    occurredAt: row.occurred_at,
    status: row.status,
  };
}

export function rowToGuildMessage(row: GuildMessageRow): AdminGuildMessageRecord {
  return {
    channelId: row.channel_id,
    discordGuildId: row.discord_guild_id,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    id: row.id,
    messageId: row.message_id,
    messageType: row.message_type,
    occurredAt: row.occurred_at,
    status: row.status,
  };
}

export function rowToAutomationRun(row: AutomationRunRow): AdminAutomationRunRecord {
  return {
    automationType: row.automation_type,
    discordGuildId: row.discord_guild_id,
    durationMs: row.duration_ms,
    eventType: row.event_type,
    failureCount: row.failure_count,
    id: row.id,
    occurredAt: row.occurred_at,
    result: parseJsonField(row.result_json),
    runId: row.run_id,
    skippedCount: row.skipped_count,
    status: row.status,
    successCount: row.success_count,
  };
}

export function rowToFailure(row: FailureRow): AdminFailureRecord {
  return {
    action: row.action,
    affectsHealth: row.affects_health === 1,
    details: parseJsonField(row.details_json),
    discordGuildId: row.discord_guild_id,
    discordUserId: row.discord_user_id,
    errorCode: row.error_code,
    eventType: row.event_type,
    id: row.id,
    message: row.message,
    occurredAt: row.occurred_at,
    runId: row.run_id,
    severity: row.severity,
    source: row.source,
  };
}

export function rowToGuild(row: GuildRow): AdminGuildRecord {
  return {
    botLogChannelId: row.bot_log_channel_id,
    botModeratorRoleId: row.bot_moderator_role_id,
    botPermissions: row.bot_permissions,
    cachedMemberCount: row.cached_member_count,
    discordGuildId: row.discord_guild_id,
    lastError: row.last_error,
    lastFullRefreshAt: row.last_full_refresh_at,
    lastSeenAt: row.last_seen_at,
    linked: Boolean(row.linked_at),
    linkedAt: row.linked_at,
    memberCount: row.member_count,
    name: row.name,
    nextRefreshAfter: row.next_refresh_after,
    refreshStatus: row.refresh_status,
    runAnnouncementChannelId: row.run_announcement_channel_id,
    syncDiscordNamesToFf14: row.sync_discord_names_to_ff14 === 1,
    unavailable: row.unavailable === 1,
    upcomingRaiderRoleId: row.upcoming_raider_role_id,
    updatedAt: row.updated_at,
  };
}
