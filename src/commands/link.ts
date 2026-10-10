import {
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type InteractionEditReplyOptions,
} from "discord.js";

import { FullpartyApiError } from "../fullparty/client.js";
import { captureFullpartyCommandPayload } from "../fullparty/commandPayloadCapture.js";
import {
  createAccountLinkInstructions,
  createGuildConnectedMessage,
  createGuildLinkInstructions,
  createUserConnectedMessage,
  type LinkV2Message,
} from "../discord/linkMessages.js";
import { recordFailureSafely, serializeFailureError } from "../health/failureReporter.js";
import { getStringProperty, isRecord } from "../lib/valueReaders.js";
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

    if (
      isGuildLink &&
      !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)
    ) {
      await interaction.reply({
        content: "You need Manage Server to link this Discord server to FullParty.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (isGuildLink) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } else {
      await interaction.deferReply();
    }

    const token = interaction.options.getString("token")?.trim();

    if (!token) {
      await interaction.editReply(
        createMissingTokenMessage(isGuildLink, context.fullpartyWebBaseUrl),
      );
      return;
    }

    await interaction.editReply({
      content: createLinkValidationMessage(token),
    });

    let response: unknown;
    try {
      response = isGuildLink
        ? await linkGuild(interaction, context, token)
        : await linkUser(interaction, context, token);
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
      ...(isGuildLink
        ? createGuildLinkSuccessMessage(context.fullpartyWebBaseUrl, response)
        : createUserLinkSuccessMessage(context.fullpartyWebBaseUrl, response)),
      content: null,
      embeds: [],
    });
  },
};

async function linkGuild(
  interaction: Parameters<ChatInputCommand["execute"]>[0],
  context: Parameters<ChatInputCommand["execute"]>[1],
  token: string,
): Promise<unknown> {
  const guildId = interaction.guildId;

  if (!guildId) {
    throw new Error("Expected guild interaction to include a guild id.");
  }

  const iconUrl = interaction.guild?.iconURL({ size: 256 }) ?? null;
  const permissions = interaction.appPermissions.bitfield.toString();

  const response = await captureFullpartyCommandPayload({
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
  await context.guildSettings.update(guildId, {
    groupSlug: getLinkedGroupSlug(getLinkResponseData(response)) ?? null,
    linkedAt: new Date().toISOString(),
  });
  await context.guildMemberCacheScheduler?.enqueueRefresh(guildId, "guild_linked");
  return response;
}

async function linkUser(
  interaction: Parameters<ChatInputCommand["execute"]>[0],
  context: Parameters<ChatInputCommand["execute"]>[1],
  token: string,
): Promise<unknown> {
  return captureFullpartyCommandPayload({
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
): InteractionEditReplyOptions {
  return isGuildLink
    ? createGuildLinkInstructions()
    : createAccountLinkInstructions({ fullpartyWebBaseUrl });
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

function createGuildLinkSuccessMessage(
  fullpartyWebBaseUrl: string,
  response?: unknown,
): LinkV2Message {
  const data = getLinkResponseData(response);
  return createGuildConnectedMessage({
    fullpartyWebBaseUrl,
    botSettingsUrl: data?.discord_settings_url,
    groupSlug: getLinkedGroupSlug(data),
  });
}

function getLinkResponseData(response: unknown): Record<string, unknown> | undefined {
  return isRecord(response)
    ? isRecord(response.data)
      ? response.data
      : response
    : undefined;
}

function getLinkedGroupSlug(
  data: Record<string, unknown> | undefined,
): string | undefined {
  const slug = data
    ? (
        getStringProperty(data, "group_slug") ??
        (isRecord(data.group) ? getStringProperty(data.group, "slug") : undefined)
      )?.trim()
    : undefined;
  return slug && slug.length <= 200 ? slug : undefined;
}

function createUserLinkSuccessMessage(
  fullpartyWebBaseUrl: string,
  response?: unknown,
): LinkV2Message {
  const data = isRecord(response) && isRecord(response.data) ? response.data : undefined;
  return createUserConnectedMessage({
    fullpartyWebBaseUrl,
    accountSettingsUrl: data?.account_settings_url,
  });
}
