import { z } from "zod";

export const notificationDeliveryDataSchema = z.looseObject({
  category: z.string().trim().min(1),
  discord_user: z.looseObject({
    id: z.string().trim().min(1),
  }),
  notification: z.looseObject({
    action_url: z.string().trim().min(1).optional(),
    category: z.string().trim().min(1),
    params: z.record(z.string(), z.unknown()).default({}),
    payload: z.unknown().optional(),
    type: z.string().trim().min(1),
  }),
  notification_delivery_id: z.number().int().positive(),
  notification_event_id: z.number().int().positive(),
  type: z.string().trim().min(1),
  user: z
    .looseObject({
      id: z.number().int().positive(),
      name: z.string().trim().min(1),
    })
    .optional(),
});

export type NotificationDeliveryData = z.infer<typeof notificationDeliveryDataSchema>;

export type NotificationTone = "danger" | "info" | "neutral" | "success" | "warning";

export type NotificationCopy = {
  actionLabel?: string | undefined;
  description: string;
  title: string;
  tone: NotificationTone;
};
