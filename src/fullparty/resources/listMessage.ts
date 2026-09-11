import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  escapeMarkdown,
} from "discord.js";
import type { ResourceListResponse } from "./schemas.js";
import type { ResourceMessage } from "./messages.js";
import { createResourceLinkRows } from "./components.js";
import { invalidResponse } from "./service.js";
import { truncateForDiscord } from "../../notifications/notificationText.js";

export function createResourceListMessage(
  result: ResourceListResponse,
  sessionId: string,
  query: string | null = null,
): ResourceMessage {
  const { data, meta } = result;
  const lines = data.map((resource) => {
    const name = escapeMarkdown(resource.command_name);
    const title = resource.title
      ? escapeMarkdown(
          truncateForDiscord(resource.title.replaceAll(/[\r\n]+/gu, " "), 60),
        )
      : "Untitled resource";
    return `**/info name:${name}** - ${title}`;
  });
  const description = [
    ...(query ? [`Matches for **${escapeMarkdown(query)}**`, ""] : []),
    ...lines,
  ].join("\n");
  if (description.length > 4096)
    throw invalidResponse(
      new Error("Resource list exceeds Discord's description limit."),
    );
  const embed = new EmbedBuilder()
    .setTitle(query ? "FullParty Resource Search" : "FullParty Resources")
    .setColor(0x8b5cf6)
    .setDescription(
      description || "No resources have been published for this server yet.",
    )
    .setFooter({
      text: `${String(meta.total)} resources | Page ${String(meta.current_page)}/${String(meta.last_page)}`,
    });
  const navigation = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        `info:previous:${sessionId}:${String(Math.max(1, meta.current_page - 1))}`,
      )
      .setLabel("Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(meta.current_page === 1),
    new ButtonBuilder()
      .setCustomId(
        `info:next:${sessionId}:${String(meta.next_page ?? meta.current_page)}`,
      )
      .setLabel("Next")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(meta.next_page === null),
  );
  return {
    content: "",
    embeds: [embed],
    components: [navigation, ...createResourceLinkRows(result.components)],
    allowedMentions: { parse: [], repliedUser: false },
  };
}
