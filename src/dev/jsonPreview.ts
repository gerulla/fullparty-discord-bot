import { randomUUID } from "node:crypto";
import { MessageFlags, Routes, type Message } from "discord.js";
import { z } from "zod";

import type { BotContext } from "../bot/context.js";
import { getDiscordApiErrorCode } from "../lib/errors.js";
import { isRecord } from "../lib/valueReaders.js";

export const jsonPreviewCustomIdPrefix = "json-preview:";
const usage =
  'Send `!json {"content":"Hello!"}` or paste a complete V1/V2 message payload after `!json`. JSON code blocks work too.';
const object = z.record(z.string(), z.unknown());
const previewSchema = z.object({
  content: z.string().max(2000).optional(),
  embeds: z.array(object).max(10).optional(),
  components: z.array(object).max(40).optional(),
  poll: object.optional(),
  flags: z.number().int().nonnegative().max(0x7fffffff).optional(),
  tts: z.boolean().optional(),
});
export class PreviewInputError extends Error {}

/** Parse only message data. Never pass user-supplied files or paths to discord.js. */
export function parseJsonPreview(
  input: string,
  options: { allowAttachments?: boolean } = {},
): Record<string, unknown> {
  const trimmed = input.trim();
  const source = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed)?.[1] ?? trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    throw new PreviewInputError(
      "That is not valid JSON. Check the quotes, commas and brackets, then try again.",
    );
  }
  if (isRecord(parsed) && isRecord(parsed.message)) parsed = parsed.message;
  if (!isRecord(parsed) || Array.isArray(parsed))
    throw new PreviewInputError(
      "Use a JSON message object, not an array or a plain string.",
    );
  if (
    !options.allowAttachments &&
    (hasItems(parsed.files) ||
      hasItems(parsed.attachments) ||
      JSON.stringify(parsed).includes("attachment://"))
  )
    throw new PreviewInputError(
      "This text-only preview cannot upload attachments. Use https:// image and media URLs in your JSON.",
    );
  const result = previewSchema.safeParse(parsed);
  if (!result.success) {
    const problem = result.error.issues[0];
    const path = problem?.path.length ? problem.path.join(".") : "message";
    throw new PreviewInputError(
      `Invalid message JSON: ${path} — ${problem?.message ?? "check the payload"}.`,
    );
  }
  const data = result.data;
  if (
    !data.content &&
    !data.embeds?.length &&
    !data.components?.length &&
    !data.poll &&
    !(options.allowAttachments && hasItems(parsed.files))
  )
    throw new PreviewInputError(
      "The message is empty. Include content, embeds, components or a poll.",
    );
  let usesV2 = Boolean((data.flags ?? 0) & MessageFlags.IsComponentsV2);
  let componentIndex = 0;
  const id = randomUUID();
  function omitBlankDescription(media: unknown): void {
    if (
      isRecord(media) &&
      typeof media.description === "string" &&
      !media.description.trim()
    )
      delete media.description;
  }
  function visit(value: unknown, depth: number): void {
    if (depth > 20)
      throw new PreviewInputError("The component layout is nested too deeply.");
    if (!isRecord(value)) return;
    if (value.type === 11) omitBlankDescription(value);
    if (value.type === 12 && Array.isArray(value.items))
      value.items.forEach(omitBlankDescription);
    if ([9, 10, 11, 12, 13, 14, 17].includes(Number(value.type))) usesV2 = true;
    // Render the controls, but keep clicks away from real setup/role/run handlers.
    if (typeof value.custom_id === "string")
      value.custom_id = `${jsonPreviewCustomIdPrefix}${id}:${String(componentIndex++)}`;
    if (Array.isArray(value.components))
      for (const child of value.components) visit(child, depth + 1);
    if (value.accessory) visit(value.accessory, depth + 1);
  }
  for (const component of data.components ?? []) visit(component, 0);
  if (
    usesV2 &&
    (data.content ||
      data.embeds?.length ||
      data.poll ||
      hasItems(parsed.stickers) ||
      hasItems(parsed.sticker_ids))
  )
    throw new PreviewInputError(
      "Components V2 cannot include traditional content, embeds, polls or stickers. Put the text in Text Display components.",
    );
  const flags =
    ((data.flags ?? 0) &
      (MessageFlags.SuppressEmbeds | MessageFlags.SuppressNotifications)) |
    (usesV2 ? MessageFlags.IsComponentsV2 : 0);
  const payload: Record<string, unknown> = {
    ...data,
    flags,
    allowed_mentions: { parse: [], replied_user: false },
  };
  if (usesV2) {
    delete payload.content;
    delete payload.embeds;
  }
  return payload;
}

function hasItems(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null;
}

export async function handleJsonPreviewMessage(
  message: Message,
  context: BotContext,
): Promise<boolean> {
  if (
    message.author.bot ||
    !context.developmentJsonEnabled ||
    !/^!json(?:\s|$)/iu.test(message.content.trim())
  )
    return false;
  // Bot DMs already expose message content; no additional privileged intent is needed.
  if (message.inGuild()) return true;
  const reply = (content: string) =>
    message.reply({ content, allowedMentions: { parse: [], repliedUser: false } });
  if (
    !context.payloadCommandAllowedUserId ||
    message.author.id !== context.payloadCommandAllowedUserId
  ) {
    await reply("This preview command is only available to the configured bot owner.");
    return true;
  }
  const input = message.content.trim().slice(5).trim();
  if (!input) {
    await reply(usage);
    return true;
  }
  try {
    const payload = parseJsonPreview(input);
    // Raw JSON goes only to Discord, so files/URLs cannot cause local file reads or bot-side downloads.
    await message.client.rest.post(Routes.channelMessages(message.channelId), {
      body: payload,
    });
  } catch (error) {
    if (error instanceof PreviewInputError) {
      await reply(error.message);
    } else if (["50035", "50006"].includes(getDiscordApiErrorCode(error) ?? "")) {
      const detail = error instanceof Error ? error.message : "Invalid message payload.";
      await reply(`Discord rejected this preview:\n${detail.slice(0, 1700)}`);
    } else {
      throw error;
    }
  }
  return true;
}
