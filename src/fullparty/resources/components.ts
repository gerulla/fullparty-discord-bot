import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import type { ResourceComponents } from "./schemas.js";

export function createResourceLinkRows(
  components: ResourceComponents,
): ActionRowBuilder<ButtonBuilder>[] {
  return components.map((row) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      row.components.map((button) => {
        const builder = new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel(button.label)
          .setURL(button.url);
        if (typeof button.disabled === "boolean") builder.setDisabled(button.disabled);
        return builder;
      }),
    ),
  );
}
