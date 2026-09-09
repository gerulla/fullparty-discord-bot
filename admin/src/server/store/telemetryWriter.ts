import type { DatabaseSync } from "node:sqlite";
import type {
  AdminAutomationRunInput,
  AdminBotEventInput,
  AdminCommandUsageInput,
  AdminDmDeliveryInput,
  AdminGuildMessageInput,
  AdminGuildRuntimeInput,
} from "../../shared/telemetry.js";
import { safeStringify } from "./queryHelpers.js";

export class AdminTelemetryWriter {
  public constructor(private readonly database: DatabaseSync) {}
  public recordBotEvent(input: AdminBotEventInput): Promise<void> {
    this.database
      .prepare(
        `
          INSERT INTO bot_events (
            data_type,
            discord_guild_id,
            discord_user_id,
            error_code,
            event_type,
            occurred_at,
            request_host,
            request_id,
            status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.dataType ?? null,
        input.discordGuildId ?? null,
        input.discordUserId ?? null,
        input.errorCode ?? null,
        input.eventType,
        input.occurredAt ?? new Date().toISOString(),
        input.requestHost ?? null,
        input.requestId ?? null,
        input.status,
      );

    return Promise.resolve();
  }

  public recordDmDelivery(input: AdminDmDeliveryInput): Promise<void> {
    this.database
      .prepare(
        `
          INSERT INTO dm_deliveries (
            discord_user_id,
            error_code,
            error_message,
            event_type,
            message_id,
            notification_type,
            occurred_at,
            queued_at,
            sent_at,
            status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.discordUserId,
        input.errorCode ?? null,
        input.errorMessage ?? null,
        input.eventType ?? null,
        input.messageId ?? null,
        input.notificationType ?? null,
        input.occurredAt ?? new Date().toISOString(),
        input.queuedAt ?? null,
        input.sentAt ?? null,
        input.status,
      );

    return Promise.resolve();
  }

  public recordCommandUsage(input: AdminCommandUsageInput): Promise<void> {
    this.database
      .prepare(
        `
          INSERT INTO command_usages (
            command_name,
            discord_guild_id,
            discord_user_id,
            duration_ms,
            error_code,
            occurred_at,
            status
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.commandName,
        input.discordGuildId ?? null,
        input.discordUserId ?? null,
        input.durationMs ?? null,
        input.errorCode ?? null,
        input.occurredAt ?? new Date().toISOString(),
        input.status,
      );

    return Promise.resolve();
  }

  public recordGuildMessage(input: AdminGuildMessageInput): Promise<void> {
    this.database
      .prepare(
        `
          INSERT INTO guild_messages (
            channel_id,
            discord_guild_id,
            error_code,
            error_message,
            message_id,
            message_type,
            occurred_at,
            status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.channelId ?? null,
        input.discordGuildId ?? null,
        input.errorCode ?? null,
        input.errorMessage ?? null,
        input.messageId ?? null,
        input.messageType,
        input.occurredAt ?? new Date().toISOString(),
        input.status,
      );

    return Promise.resolve();
  }

  public recordGuildRuntime(input: AdminGuildRuntimeInput): Promise<void> {
    const now = input.lastSeenAt ?? new Date().toISOString();

    this.database
      .prepare(
        `
          INSERT INTO guild_runtime (
            bot_permissions,
            discord_guild_id,
            last_seen_at,
            linked_at,
            member_count,
            name,
            unavailable
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(discord_guild_id) DO UPDATE SET
            bot_permissions = excluded.bot_permissions,
            last_seen_at = excluded.last_seen_at,
            linked_at = excluded.linked_at,
            member_count = excluded.member_count,
            name = excluded.name,
            unavailable = excluded.unavailable
        `,
      )
      .run(
        input.botPermissions ?? null,
        input.discordGuildId,
        now,
        input.linkedAt ?? null,
        input.memberCount ?? null,
        input.name ?? null,
        input.unavailable ? 1 : 0,
      );

    return Promise.resolve();
  }

  public recordAutomationRun(input: AdminAutomationRunInput): Promise<void> {
    this.database
      .prepare(
        `
          INSERT INTO automation_runs (
            automation_type,
            discord_guild_id,
            duration_ms,
            event_type,
            failure_count,
            occurred_at,
            result_json,
            run_id,
            skipped_count,
            status,
            success_count
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.automationType,
        input.discordGuildId ?? null,
        input.durationMs ?? null,
        input.eventType ?? null,
        input.failureCount ?? 0,
        input.occurredAt ?? new Date().toISOString(),
        input.result === undefined ? null : safeStringify(input.result),
        input.runId ?? null,
        input.skippedCount ?? 0,
        input.status,
        input.successCount ?? 0,
      );

    return Promise.resolve();
  }
}
