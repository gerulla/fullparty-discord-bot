import { EmbedBuilder, type BaseMessageOptions } from "discord.js";
import type { ResourceData } from "./schemas.js";
import { createResourceLinkRows } from "./components.js";
import { invalidResponse } from "./service.js";

export type ResourceMessage = Pick<
  BaseMessageOptions,
  "content" | "embeds" | "components" | "files" | "allowedMentions"
>;

export function createResourceMessage(resource: ResourceData): ResourceMessage {
  const data = resource.embed;
  const embed = new EmbedBuilder();
  if (data.title) embed.setTitle(data.title);
  if (data.description) embed.setDescription(data.description);
  if (data.url) embed.setURL(data.url);
  if (data.color !== null && data.color !== undefined) embed.setColor(data.color);
  if (data.timestamp) embed.setTimestamp(new Date(data.timestamp));
  if (data.footer) embed.setFooter({ text: data.footer.text });
  if (data.author)
    embed.setAuthor({
      name: data.author.name,
      ...(data.author.url ? { url: data.author.url } : {}),
      ...(data.author.icon_url ? { iconURL: data.author.icon_url } : {}),
    });
  if (data.image?.url) embed.setImage(data.image.url);
  if (data.thumbnail?.url) embed.setThumbnail(data.thumbnail.url);
  if (data.fields)
    embed.addFields(
      data.fields.map((field) => ({
        name: field.name,
        value: field.value,
        ...(typeof field.inline === "boolean" ? { inline: field.inline } : {}),
      })),
    );
  if (
    embed.length > 6000 ||
    (!embed.length && !data.image?.url && !data.thumbnail?.url)
  ) {
    throw invalidResponse(
      new Error("Resource embed is empty or exceeds Discord's total text limit."),
    );
  }
  return {
    embeds: [embed],
    components: createResourceLinkRows(resource.components),
    allowedMentions: { parse: [], repliedUser: false },
  };
}
