import { MessageFlags, type MessageCreateOptions } from "discord.js";
import { isRecord } from "../lib/valueReaders.js";

type CachedEmoji = {
  id: string;
  name: string | null;
  animated?: boolean | null;
  available?: boolean | null;
};

export type MessageEmojiSource = {
  application?: { emojis: { cache: ReadonlyMap<string, CachedEmoji> } } | null;
  emojis?: { cache: ReadonlyMap<string, CachedEmoji> };
};

const iconFallbacks: Record<string, string> = {
  fpcheck: "✅",
  fperrorx: "❌",
  fpupdate: "🔄",
  fpnote: "📝",
  fpdocument: "📄",
  fppercent: "%",
  fpatsymbol: "@",
  fpnametag: "🏷️",
  fpflag: "🏁",
  fppin: "📍",
  fpclock: "🕒",
  fpedit: "✏️",
  fpchart: "📊",
};

/** Resolve workshop icon names only at delivery, when the bot's emoji cache is ready. */
export function resolveV2MessageIcons(
  message: MessageCreateOptions,
  source: MessageEmojiSource,
): MessageCreateOptions {
  if (
    typeof message.flags !== "number" ||
    !(message.flags & MessageFlags.IsComponentsV2)
  ) {
    return message;
  }
  const icons = new Map<string, CachedEmoji>();
  for (const cache of [source.emojis?.cache, source.application?.emojis.cache]) {
    for (const emoji of cache?.values() ?? []) {
      if (emoji.name && emoji.available !== false && /^\d+$/u.test(emoji.id)) {
        icons.set(emoji.name, emoji);
      }
    }
  }
  const replace = (text: string) =>
    text.replace(/(?<!<)(?<!<a):((?:fp)[a-z]+):/gu, (match: string, name: string) => {
      const fallback = iconFallbacks[name];
      if (!fallback) return match;
      const emoji = icons.get(name);
      return emoji ? `<${emoji.animated ? "a" : ""}:${name}:${emoji.id}>` : fallback;
    });
  // Components can be builders; JSON serialization also preserves their toJSON output.
  const components = JSON.parse(JSON.stringify(message.components ?? [])) as unknown;
  const textBlocks: Record<string, unknown>[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
    } else if (isRecord(value)) {
      if (value.type === 10 && typeof value.content === "string") {
        value.content = replace(value.content);
        textBlocks.push(value);
      }
      if (Array.isArray(value.components)) visit(value.components);
    }
  };
  visit(components);
  // Emoji markup is longer than workshop aliases; enforce the combined text limit after resolving it.
  let remaining = 4000;
  for (const [index, block] of textBlocks.entries()) {
    const text = String(block.content);
    const budget = Math.max(1, remaining - (textBlocks.length - index - 1));
    if (text.length > budget)
      block.content = text.slice(0, Math.max(0, budget - 1)) + "…";
    remaining -= String(block.content).length;
  }
  return {
    ...message,
    components: components as NonNullable<MessageCreateOptions["components"]>,
  };
}
