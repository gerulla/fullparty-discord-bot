import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type APIButtonComponentWithURL,
  type APIComponentInContainer,
  type APIMessageTopLevelComponent,
  type APITextDisplayComponent,
} from "discord.js";
import { getDiscordAppInstallUrl } from "../fullparty/discordAppInstall.js";

export type LinkMessageOptions = {
  fullpartyWebBaseUrl: string;
  installUrl?: unknown;
  accountSettingsUrl?: unknown;
  botSettingsUrl?: unknown;
  groupSlug?: unknown;
  feedbackUrl?: unknown;
  disconnectGuideImageUrl?: unknown;
  welcomeMessage?: string | undefined;
};

export type LinkV2Message = {
  flags: MessageFlags.IsComponentsV2;
  allowedMentions: { parse: []; repliedUser: false };
  components: APIMessageTopLevelComponent[];
};

const footer = "-# FullParty - Automated Message";

export function createDiscordLoginWelcomeMessage(
  options: LinkMessageOptions,
): LinkV2Message {
  return message([
    text(
      "## Welcome to FullParty\nYou've signed in with Discord. Finish connecting the FullParty app to receive run updates, reminders and access your FullParty account through Discord interactions.",
    ),
    ...accountSetup(options),
    text(footer),
  ]);
}

export function createAccountLinkInstructions(
  options: LinkMessageOptions,
): LinkV2Message {
  return message([
    text(
      "## Link FullParty to Your Account\nTo link the FullParty bot to your account, choose one of the following options. We recommend **Automated Setup** for the quickest setup.",
    ),
    separator(false, 1),
    ...accountSetup(options),
    text(footer),
  ]);
}

export function createUserConnectedMessage(options: LinkMessageOptions): LinkV2Message {
  const welcomeMessage = options.welcomeMessage?.trim();
  return message([
    text(
      welcomeMessage
        ? welcomeMessage.slice(0, 2000)
        : "## Thank You for Connecting Your Discord Account!\nYou're all set to use our services and receive the notifications you need!",
    ),
    separator(),
    section(
      "You can customize which DMs you receive from us by opening your FullParty account settings and disabling the notifications you don't need.",
      "Account Settings",
      accountSettingsUrl(options),
    ),
    separator(),
    text(
      "### Discord Integrations Available to You\nUse `/help` to see the commands available to you. These help you manage applications, view runs and group information without leaving Discord.",
    ),
    separator(),
    text(
      "You can disconnect the FullParty app at any time from your FullParty account settings.",
    ),
    text(footer),
  ]);
}

export function createUserDisconnectedMessage(
  options: LinkMessageOptions,
): LinkV2Message {
  const guideImage = safeUrl(options.disconnectGuideImageUrl, options, 2048);
  return message([
    text("## FullParty Bot Has Been Disconnected from Your Account."),
    section(
      "We're sad to see you go! If our services were unsatisfactory, we'd appreciate your feedback on how we can improve.",
      "Leave Feedback",
      safeUrl(options.feedbackUrl, options),
    ),
    separator(true, 1),
    text(
      "### Further Action\nTo fully remove the app from Discord, open **Discord Settings** > **Authorized Apps** and deauthorize `FullParty`.",
    ),
    ...(guideImage
      ? [
          {
            type: ComponentType.MediaGallery as const,
            items: [{ media: { url: guideImage } }],
          },
        ]
      : []),
    text(footer),
  ]);
}

export function createGuildLinkInstructions(): LinkV2Message {
  return message([
    text("## Link FullParty to Your Discord Server"),
    separator(false, 1),
    {
      type: ComponentType.Container,
      accent_color: 5430095,
      components: [
        text("### Setup"),
        text(
          [
            "1. Open your group's Discord settings on FullParty (**Group** > **Configuration** > **Discord**).",
            "2. Select **Generate Link Token** and copy the token.",
            "3. In this server, use `/link token:<code>` to finish the setup.",
            "4. You should receive a confirmation message if the setup was successful.",
          ].join("\n"),
        ),
      ],
    },
    text(footer),
  ]);
}

export function createGuildConnectedMessage(options: LinkMessageOptions): LinkV2Message {
  return message([
    text(
      "## Thank You for Linking Your Discord Server!\nYou're all set to use our services and bot interactions for your moderators and users.",
    ),
    separator(),
    section(
      "You can manage the bot configuration for your server on the website or with `/setup` in this Discord server.",
      "Bot Settings",
      guildSettingsUrl(options),
    ),
    separator(),
    text(
      "### Discord Integrations Available to You\nUse `/help` to see the commands available to you. These help you manage roles, nicknames and schedules, and view runs and group information without leaving Discord.",
    ),
    separator(),
    text(
      "You can disconnect the FullParty app at any time from your group's Discord settings on FullParty.",
    ),
    text(footer),
  ]);
}

export function createAccountLinkRequiredMessage(): LinkV2Message {
  return message([
    text(
      "### Your Discord Account Is Not Linked to FullParty Yet.\nPlease use `/link` in a DM with the bot for instructions on linking FullParty to your account.",
    ),
  ]);
}

export function createGuildLinkRequiredMessage(): LinkV2Message {
  return message([
    text(
      "### Your Discord Server Is Not Linked to FullParty.\nPlease use `/link` in this server for instructions on linking FullParty to your server.",
    ),
  ]);
}

function accountSetup(options: LinkMessageOptions): APIMessageTopLevelComponent[] {
  const installUrl =
    safeUrl(options.installUrl, options) ??
    safeUrl(getDiscordAppInstallUrl(options.fullpartyWebBaseUrl), options);
  const settingsUrl = accountSettingsUrl(options);
  return [
    {
      type: ComponentType.Container,
      accent_color: 6547341,
      components: [
        text(
          [
            "### Automated Setup",
            "1. Select **Finish Discord Setup** below and sign in to FullParty if needed.",
            "2. Follow the Discord prompts to authorize the FullParty bot for your account.",
            "3. You should receive a confirmation message if the setup was successful.",
          ].join("\n"),
        ),
        ...buttonRow("Finish Discord Setup", installUrl),
      ],
    },
    {
      type: ComponentType.Container,
      accent_color: 15243106,
      components: [
        text("### Manual Setup"),
        text(
          [
            "1. Open your FullParty account settings.",
            "2. Scroll to **Discord App** under **Notifications**.",
            "3. Select **Generate Link Token** and copy the token.",
            "4. In a DM with this bot, use `/link token:<code>` to finish the setup.",
            "5. You should receive a confirmation message if the setup was successful.",
          ].join("\n"),
        ),
        ...buttonRow("Account Settings", settingsUrl),
      ],
    },
  ];
}

function accountSettingsUrl(options: LinkMessageOptions): string | undefined {
  return safeUrl(options.accountSettingsUrl, options) ?? safeUrl("/settings", options);
}

export function guildSettingsUrl(options: LinkMessageOptions): string | undefined {
  const explicitUrl = safeUrl(options.botSettingsUrl, options);
  if (explicitUrl) return explicitUrl;

  const slug = typeof options.groupSlug === "string" ? options.groupSlug.trim() : "";
  if (!slug || slug === "." || slug === "..") return undefined;

  try {
    return safeUrl(
      `/groups/${encodeURIComponent(slug)}/dashboard/discord-integration`,
      options,
    );
  } catch {
    return undefined;
  }
}

function safeUrl(
  value: unknown,
  options: LinkMessageOptions,
  limit = 512,
): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim(), options.fullpartyWebBaseUrl);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.href.length <= limit
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function message(components: APIMessageTopLevelComponent[]): LinkV2Message {
  return {
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [], repliedUser: false },
    components,
  };
}

function text(content: string): APITextDisplayComponent {
  return { type: ComponentType.TextDisplay, content };
}

function separator(divider = true, spacing: 1 | 2 = 2): APIComponentInContainer {
  return { type: ComponentType.Separator, divider, spacing };
}

function button(label: string, url: string): APIButtonComponentWithURL {
  return { type: ComponentType.Button, style: ButtonStyle.Link, label, url };
}

function buttonRow(label: string, url: string | undefined): APIComponentInContainer[] {
  return url ? [{ type: ComponentType.ActionRow, components: [button(label, url)] }] : [];
}

function section(
  content: string,
  label: string,
  url: string | undefined,
): APIMessageTopLevelComponent {
  return url
    ? {
        type: ComponentType.Section,
        components: [text(content)],
        accessory: button(label, url),
      }
    : text(content);
}
