import { z } from "zod";

const httpUrl = z
  .url()
  .refine(
    (value) => ["https:", "http:"].includes(new URL(value).protocol),
    "Expected an HTTP(S) URL.",
  );
const text = (max: number) => z.string().min(1).max(max);
const filename = text(255).refine(
  (value) => !/[\\/\p{Cc}]/u.test(value) && value !== "." && value !== "..",
  "Expected a plain attachment filename.",
);
const imageUrl = z.union([
  httpUrl,
  z
    .string()
    .startsWith("attachment://")
    .refine((value) => filename.safeParse(value.slice("attachment://".length)).success),
]);
const resourceAssetSchema = z.object({
  id: text(100),
  filename,
  mime_type: text(100),
  url: httpUrl,
});
const resourceComponentSchema = z.object({
  type: z.literal(1),
  components: z
    .array(
      z.object({
        type: z.literal(2),
        style: z.literal(5),
        label: text(80),
        url: httpUrl,
        disabled: z.boolean().nullish(),
      }),
    )
    .min(1)
    .max(5),
});

export const resourceListResponseSchema = z.object({
  data: z
    .array(z.object({ command_name: text(100), title: z.string().nullable() }))
    .max(100),
  // Leave a Discord action row available for the bot's pagination controls.
  components: z.array(resourceComponentSchema).max(4).default([]),
  meta: z.object({
    group_id: z.number().int().positive(),
    discord_guild_id: z.string(),
    current_page: z.number().int().positive(),
    per_page: z.number().int().min(1).max(100),
    total: z.number().int().nonnegative(),
    last_page: z.number().int().positive(),
    next_page: z.number().int().positive().nullable(),
  }),
});

const resourceEmbedSchema = z.object({
  title: text(256).nullish(),
  description: text(4096).nullish(),
  url: httpUrl.nullish(),
  color: z.number().int().min(0).max(0xffffff).nullish(),
  timestamp: z.iso.datetime({ offset: true }).nullish(),
  footer: z.object({ text: text(2048) }).nullish(),
  author: z
    .object({ name: text(256), url: httpUrl.nullish(), icon_url: httpUrl.nullish() })
    .nullish(),
  image: z.object({ url: imageUrl.nullish() }).nullish(),
  thumbnail: z.object({ url: imageUrl.nullish() }).nullish(),
  fields: z
    .array(
      z.object({ name: text(256), value: text(1024), inline: z.boolean().nullish() }),
    )
    .max(25)
    .nullish(),
});

export const resourceResponseSchema = z.object({
  found: z.literal(true),
  data: z.object({
    command_name: text(100),
    embed: resourceEmbedSchema,
    assets: z.array(resourceAssetSchema).max(10),
    components: z.array(resourceComponentSchema).max(5),
  }),
});

export const resourceLookupResponseSchema = z.discriminatedUnion("found", [
  resourceResponseSchema,
  resourceListResponseSchema.extend({ found: z.literal(false) }),
]);

export type ResourceListResponse = z.infer<typeof resourceListResponseSchema>;
export type ResourceLookupResponse = z.infer<typeof resourceLookupResponseSchema>;
export type ResourceComponents = z.infer<typeof resourceComponentSchema>[];
export type ResourceData = z.infer<typeof resourceResponseSchema>["data"];
export type ResourceAsset = z.infer<typeof resourceAssetSchema>;
