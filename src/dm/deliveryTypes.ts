import { z } from "zod";

const embedSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  url: z.string().optional(),
  color: z.number().int().optional(),
  timestamp: z.string().optional(),
  footer: z.object({ text: z.string(), icon_url: z.string().optional() }).optional(),
  thumbnail: z.object({ url: z.string() }).optional(),
  image: z.object({ url: z.string() }).optional(),
  author: z
    .object({
      name: z.string(),
      url: z.string().optional(),
      icon_url: z.string().optional(),
    })
    .optional(),
  fields: z
    .array(
      z.object({ name: z.string(), value: z.string(), inline: z.boolean().optional() }),
    )
    .optional(),
});

export const dmDeliveryJobSchema = z.object({
  discordUserId: z.string().min(1),
  message: z.object({
    content: z.string().optional(),
    embeds: z.array(embedSchema).optional(),
    components: z
      .array(
        z.object({
          type: z.literal(1),
          components: z.array(
            z.object({
              type: z.literal(2),
              style: z.literal(5),
              url: z.string(),
              label: z.string().optional(),
              emoji: z.object({ name: z.string() }).optional(),
            }),
          ),
        }),
      )
      .optional(),
  }),
  metadata: z.object({
    eventType: z.string().optional(),
    notificationType: z.string().optional(),
  }),
});

export type DmDeliveryJob = z.infer<typeof dmDeliveryJobSchema>;
export type DmDeliveryResult = { discordUserId: string; messageId: string };
