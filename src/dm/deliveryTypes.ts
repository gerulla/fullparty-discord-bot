import { z } from "zod";
import { MessageFlags } from "discord.js";

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

const emojiSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  animated: z.boolean().optional(),
});
const linkButtonSchema = z.object({
  type: z.literal(2),
  style: z.literal(5),
  url: z.string(),
  label: z.string().optional(),
  emoji: emojiSchema.optional(),
  disabled: z.boolean().optional(),
});
const actionRowSchema = z.object({
  type: z.literal(1),
  components: z.array(linkButtonSchema).min(1).max(5),
});
const textDisplaySchema = z.object({
  type: z.literal(10),
  content: z.string().min(1).max(4000),
});
const mediaSchema = z.object({ url: z.string() });
const thumbnailSchema = z.object({
  type: z.literal(11),
  media: mediaSchema,
  description: z.string().min(1).max(1024).optional(),
  spoiler: z.boolean().optional(),
});
const sectionSchema = z.object({
  type: z.literal(9),
  components: z.array(textDisplaySchema).min(1).max(3),
  accessory: z.union([thumbnailSchema, linkButtonSchema]),
});
const mediaGallerySchema = z.object({
  type: z.literal(12),
  items: z
    .array(
      z.object({
        media: mediaSchema,
        description: z.string().min(1).max(1024).optional(),
        spoiler: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(10),
});
const separatorSchema = z.object({
  type: z.literal(14),
  divider: z.boolean().optional(),
  spacing: z.union([z.literal(1), z.literal(2)]).optional(),
});
const containerChildSchema = z.union([
  actionRowSchema,
  textDisplaySchema,
  sectionSchema,
  mediaGallerySchema,
  separatorSchema,
]);
const containerSchema = z.object({
  type: z.literal(17),
  accent_color: z.number().int().min(0).max(0xffffff).optional(),
  spoiler: z.boolean().optional(),
  components: z.array(containerChildSchema).min(1).max(40),
});

const messageSchema = z
  .object({
    nonce: z.string().min(1).max(25).optional(),
    enforceNonce: z.literal(true).optional(),
    content: z.string().optional(),
    embeds: z.array(embedSchema).optional(),
    components: z
      .array(z.union([containerSchema, containerChildSchema]))
      .max(40)
      .optional(),
    flags: z.literal(MessageFlags.IsComponentsV2).optional(),
    allowedMentions: z
      .object({
        parse: z.array(z.enum(["everyone", "roles", "users"])).optional(),
        users: z.array(z.string()).optional(),
        roles: z.array(z.string()).optional(),
        repliedUser: z.boolean().optional(),
      })
      .optional(),
  })
  .superRefine((message, ctx) => {
    const v2 = message.flags === MessageFlags.IsComponentsV2;
    if (v2 && (message.content !== undefined || message.embeds !== undefined)) {
      ctx.addIssue({
        code: "custom",
        message: "V2 messages cannot contain content or embeds.",
      });
    }
    if (!v2 && message.components?.some((c) => c.type !== 1)) {
      ctx.addIssue({
        code: "custom",
        message: "V2 components require the IsComponentsV2 flag.",
      });
    }
  });

export const dmDeliveryJobSchema = z.object({
  discordUserId: z.string().min(1),
  message: messageSchema,
  metadata: z.object({
    eventType: z.string().optional(),
    notificationDeliveryId: z.number().int().positive().optional(),
    notificationType: z.string().optional(),
  }),
});

export type DmDeliveryJob = z.infer<typeof dmDeliveryJobSchema>;
export type DmDeliveryResult = { discordUserId: string; messageId: string };
