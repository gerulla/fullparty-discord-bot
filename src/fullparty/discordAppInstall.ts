import {
  ButtonStyle,
  ComponentType,
  type APIActionRowComponent,
  type APIButtonComponent,
} from "discord.js";

const discordUserInstallPath = "/auth/discord-app/user/redirect";

export function getDiscordAppInstallUrl(fullpartyWebBaseUrl: string): string {
  return new URL(discordUserInstallPath, fullpartyWebBaseUrl).toString();
}

export function createDiscordAppInstallRow(
  url: string,
  label = "Finish Discord setup",
): APIActionRowComponent<APIButtonComponent> {
  return {
    type: ComponentType.ActionRow,
    components: [{ type: ComponentType.Button, style: ButtonStyle.Link, label, url }],
  };
}
