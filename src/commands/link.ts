import {
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";

import { captureFullpartyCommandPayload } from "../fullparty/commandPayloadCapture.js";
import { FullpartyApiError } from "../fullparty/client.js";
import { recordFailureSafely, serializeFailureError } from "../health/failureReporter.js";
import type { ChatInputCommand } from "./types.js";

export const linkCommand: ChatInputCommand = {
  data: new SlashCommandBuilder()
    .setName("link")
    .setDescription("Link your Discord user or server to FullParty.")
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    )
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    )
    .addStringOption((option) =>
      option
        .setName("token")
        .setDescription("The FullParty Discord link token.")
        .setMaxLength(128)
        .setMinLength(4)
        .setRequired(false),
    ),
  async execute(interaction, context) {
    const isGuildLink = interaction.inGuild();

    if (isGuildLink) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } else {
      await interaction.deferReply();
    }

    const token = interaction.options.getString("token")?.trim();

    if (!token) {
      await interaction.editReply({
        content: createMissingTokenMessage(isGuildLink, context.fullpartyWebBaseUrl),
      });
      return;
    }

    await interaction.editReply({
      content: createLinkValidationMessage(token),
    });

    try {
      if (isGuildLink) {
        await linkGuild(interaction, context, token);
      } else {
        await linkUser(interaction, context, token);
      }
    } catch (error) {
      if (error instanceof FullpartyApiError) {
        recordFailureSafely(context.failureReporter, context.logger, {
          action: isGuildLink ? "link_guild" : "link_user",
          details: {
            error: serializeFailureError(error),
            responseBody: error.body,
          },
          discordGuildId: isGuildLink ? interaction.guildId : undefined,
          discordUserId: interaction.user.id,
          errorCode: `fullparty_api_${String(error.status)}`,
          message: error.message,
          severity: "warn",
          source: "fullparty_api",
        });
        await interaction.editReply(createLinkFailureMessage(error, isGuildLink));
        return;
      }

      throw error;
    }

    await interaction.editReply({
      content: isGuildLink ? guildLinkSuccessMessage : userLinkSuccessMessage,
    });
  },
};

async function linkGuild(
  interaction: Parameters<ChatInputCommand["execute"]>[0],
  context: Parameters<ChatInputCommand["execute"]>[1],
  token: string,
): Promise<void> {
  const guildId = interaction.guildId;

  if (!guildId) {
    throw new Error("Expected guild interaction to include a guild id.");
  }

  const iconUrl = interaction.guild?.iconURL({ size: 256 }) ?? null;
  const permissions = interaction.appPermissions.bitfield.toString();

  await captureFullpartyCommandPayload({
    commandName: "link",
    discordGuildId: guildId,
    payloads: context.payloads,
    request: () =>
      context.fullparty.linkDiscordGuild({
        discordGuildId: guildId,
        iconUrl,
        name: interaction.guild?.name ?? `Discord guild ${guildId}`,
        permissions,
        token,
      }),
  });
}

async function linkUser(
  interaction: Parameters<ChatInputCommand["execute"]>[0],
  context: Parameters<ChatInputCommand["execute"]>[1],
  token: string,
): Promise<void> {
  await captureFullpartyCommandPayload({
    commandName: "link",
    discordUserId: interaction.user.id,
    payloads: context.payloads,
    request: () =>
      context.fullparty.linkDiscordUser({
        avatarUrl: interaction.user.displayAvatarURL({ size: 256 }),
        discordUserId: interaction.user.id,
        ...(interaction.user.globalName
          ? { globalName: interaction.user.globalName }
          : {}),
        token,
        username: interaction.user.username,
      }),
  });
}

function createMissingTokenMessage(
  isGuildLink: boolean,
  fullpartyWebBaseUrl: string,
): string {
  if (isGuildLink) {
    return [
      "I need a FullParty Discord server link token to connect this server.",
      `Go to ${fullpartyWebBaseUrl}, create or open the FullParty group you want to connect, then follow the Discord linking process for that group.`,
      "Once FullParty gives you a code, come back to this server and run `/link token:<code>`.",
    ].join("\n\n");
  }

  return [
    "I need a FullParty Discord link token to connect your account.",
    `Go to ${fullpartyWebBaseUrl}, open your user settings, and generate a Discord link code.`,
    "Then come back to this DM and run `/link token:<code>`.",
  ].join("\n\n");
}

function createLinkValidationMessage(token: string): string {
  return `Validating code ${token} with the FullParty server...`;
}

function createLinkFailureMessage(
  error: FullpartyApiError,
  isGuildLink: boolean,
): string {
  if (error.status === 401 || error.status === 403) {
    return isGuildLink
      ? "I could not link this Discord server because the FullParty integration API token is missing or does not include guilds:write. Please let the FullParty team know."
      : "I could not link your Discord account because the FullParty integration API token is missing or does not include users:write. Please let the FullParty team know.";
  }

  if (error.status === 409) {
    return isGuildLink
      ? "This Discord server is already linked to another FullParty group."
      : "That Discord account is already linked to another FullParty account.";
  }

  if (error.status === 404 || error.status === 410 || error.status === 422) {
    return "That link token is invalid or expired. Please generate a new Discord link token from FullParty and try again.";
  }

  return isGuildLink
    ? "I could not link this Discord server right now. Please try again in a moment."
    : "I could not link your FullParty account right now. Please try again in a moment.";
}

const guildLinkSuccessMessage =
  "✅ This Discord server is now linked to FullParty. FullParty can now use the server-side integration features configured for this guild.";

const userLinkSuccessMessage =
  "✅ Your Discord account is now linked to FullParty. You can receive FullParty updates here and use the Discord integration features tied to your account.";
