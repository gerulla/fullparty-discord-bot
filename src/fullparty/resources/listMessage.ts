import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  escapeMarkdown,
  type APIComponentInContainer,
  type APIMessageTopLevelComponent,
  type APITextDisplayComponent,
} from "discord.js";
import type { ResourceListResponse } from "./schemas.js";
import { invalidResponse, resourcePageSize } from "./service.js";
import { truncateForDiscord } from "../../notifications/notificationText.js";

export type ResourceListMessage = {
  flags: MessageFlags.IsComponentsV2;
  components: APIMessageTopLevelComponent[];
  allowedMentions: { parse: []; repliedUser: false };
};

export function createResourceListMessage(
  result: ResourceListResponse,
  sessionId: string,
  query: string | null = null,
): ResourceListMessage {
  const { data, meta } = result;
  if (data.length > resourcePageSize) {
    throw invalidResponse(new Error("Resource list exceeds the requested page size."));
  }
  const header = query
    ? `## FullParty Resource Search\nMatches for **${displayText(query, 200)}**`
    : "## FullParty Resources";
  const components: APIComponentInContainer[] = [text(header)];
  let textLength = header.length;
  for (const [index, resource] of data.entries()) {
    const name = displayText(resource.command_name, 200);
    const hasEmbed = resource.embed !== undefined;
    const hasFlatEmbedTitle = resource.embed_title !== undefined;
    const hasResourceTitle = resource.resource_title !== undefined;
    // The current list contract gives both titles explicitly. Preserve older
    // nested summaries and flat title pairs when resource_title is absent.
    const rawEmbedTitle =
      !hasResourceTitle && hasEmbed
        ? resource.embed?.title
        : hasFlatEmbedTitle
          ? resource.embed_title
          : resource.title;
    const rawResourceTitle = hasResourceTitle
      ? resource.resource_title
      : hasEmbed
        ? resource.embed?.author?.name
        : hasFlatEmbedTitle
          ? resource.title
          : undefined;
    const embedTitle = rawEmbedTitle?.trim()
      ? displayText(rawEmbedTitle, 100)
      : undefined;
    const resourceTitle = rawResourceTitle?.trim()
      ? displayText(rawResourceTitle, 100)
      : undefined;
    const content = `**/info ${name}**${embedTitle ? ` - ${embedTitle}` : ""}${resourceTitle ? `\n-# ${resourceTitle}` : ""}`;
    textLength += content.length;
    components.push(
      { type: ComponentType.Separator, divider: true, spacing: 1 },
      {
        type: ComponentType.Section,
        components: [text(content)],
        accessory: {
          type: ComponentType.Button,
          custom_id: `info:show:${sessionId}:${String(meta.current_page)}:${String(index)}`,
          label: "Show",
          style: ButtonStyle.Secondary,
        },
      },
    );
  }
  if (data.length === 0) {
    const empty = query
      ? "No resources matched your search."
      : "No resources have been published for this server yet.";
    components.push(text(empty));
    textLength += empty.length;
  }

  // Markdown links preserve all website-provided destinations without consuming
  // the remaining component slots needed for eight resource rows and navigation.
  const links = result.components.flatMap((row) =>
    row.components.map((button) => {
      const label = displayText(button.label, 160);
      const url = new URL(button.url)
        .toString()
        .replace(/[<>]/gu, (char) => encodeURIComponent(char));
      return button.disabled ? `${label} (unavailable)` : `[${label}](<${url}>)`;
    }),
  );
  const footer = [
    links.join(" · "),
    `-# ${String(meta.total)} resources | Page ${String(meta.current_page)}/${String(meta.last_page)}`,
  ]
    .filter(Boolean)
    .join("\n");
  textLength += footer.length;
  if (textLength > 4000) {
    throw invalidResponse(new Error("Resource list exceeds Discord's text limit."));
  }
  components.push(text(footer), {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        custom_id: `info:previous:${sessionId}:${String(Math.max(1, meta.current_page - 1))}`,
        label: "Previous",
        style: ButtonStyle.Secondary,
        disabled: meta.current_page === 1,
      },
      {
        type: ComponentType.Button,
        custom_id: `info:next:${sessionId}:${String(meta.next_page ?? meta.current_page)}`,
        label: "Next",
        style: ButtonStyle.Secondary,
        disabled: meta.next_page === null,
      },
    ],
  });
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [{ type: ComponentType.Container, accent_color: 9912567, components }],
    allowedMentions: { parse: [], repliedUser: false },
  };
}

function text(content: string): APITextDisplayComponent {
  return { type: ComponentType.TextDisplay, content };
}

function displayText(value: string, limit: number): string {
  return truncateForDiscord(
    escapeMarkdown(value.replace(/\s+/gu, " "), { maskedLink: true }),
    limit,
  );
}
