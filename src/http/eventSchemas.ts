import { z } from "zod";
import { notificationDeliveryDataSchema } from "../notifications/types.js";
import { HttpError } from "./httpError.js";

const fullpartyEventSchema = z.looseObject({
  data: z.unknown().optional(),
  event: z.string().trim().min(1),
  id: z.string().trim().min(1).optional(),
  requestId: z.string().trim().min(1).optional(),
  request_id: z.string().trim().min(1).optional(),
});

export const userAppEventDataSchema = z.looseObject({
  discord_user: z.looseObject({
    id: z.string().trim().min(1),
  }),
  welcome_message: z.string().trim().min(1).max(2000).optional(),
});

export const guildSnapshotRequestedDataSchema = z.looseObject({
  discord_guild_id: z.string().trim().min(1),
});

export const guildMembershipSnapshotRequestedDataSchema = z.looseObject({
  discord_guild_id: z.string().trim().min(1),
  include_member_ids: z.boolean().optional(),
  request_refresh_if_stale: z.boolean().optional(),
});

export const guildDisconnectedDataSchema = z.looseObject({
  disconnected_at: z.string().trim().min(1).optional(),
  discord_guild_id: z.string().trim().min(1),
  group_id: z.number().int().positive().optional(),
  group_name: z.string().trim().min(1).optional(),
  group_slug: z.string().trim().min(1).optional(),
});

const nullableSettingIdSchema = z.string().trim().min(1).nullable().optional();

const runRoleTemplateOverrideSchema = z.object({
  activity_id: z.number().int().positive(),
  activity_name: z.string().trim().min(1).max(300),
  created_at: z.string().trim().min(1).nullable().optional(),
  role_id: z.string().trim().min(1),
  updated_at: z.string().trim().min(1).nullable().optional(),
});

export const guildSettingsUpdatedDataSchema = z.looseObject({
  discord_guild_id: z.string().trim().min(1),
  settings: z.looseObject({
    bot_log_channel_id: nullableSettingIdSchema,
    bot_moderator_role_id: nullableSettingIdSchema,
    run_announcement_channel_id: nullableSettingIdSchema,
    run_role_template_overrides: z.array(runRoleTemplateOverrideSchema).optional(),
    run_role_template_id: nullableSettingIdSchema,
    sync_discord_names_to_ff14: z.boolean().optional(),
    upcoming_raider_role_id: nullableSettingIdSchema,
  }),
});

export const integrationHealthcheckEvent = "integration.healthcheck";

export type FullpartyEvent = z.infer<typeof fullpartyEventSchema>;

export function parseEvent(value: unknown): FullpartyEvent {
  const result = fullpartyEventSchema.safeParse(value);

  if (result.success) {
    return result.data;
  }

  const notificationDeliveryResult = notificationDeliveryDataSchema.safeParse(value);

  if (notificationDeliveryResult.success) {
    return {
      data: notificationDeliveryResult.data,
      event: "discord.notification.delivery",
    };
  }

  throw new HttpError(
    400,
    "invalid_event",
    "Request body must include a valid event type.",
    z.treeifyError(result.error),
  );
}
