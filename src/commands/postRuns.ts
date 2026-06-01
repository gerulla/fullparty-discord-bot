import {
  ApplicationIntegrationType,
  InteractionContextType,
  type MessageCreateOptions,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";

import { captureFullpartyCommandPayload } from "../fullparty/commandPayloadCapture.js";
import { createGuildUpcomingRunsPostMessage } from "../fullparty/discordGuildRunPosts.js";
import { requireGuildBotModerator } from "./guildCommandAccess.js";
import type { ChatInputCommand } from "./types.js";

const defaultLimit = 25;

export const postRunsCommand: ChatInputCommand = {
  data: new SlashCommandBuilder()
    .setName("postruns")
    .setDescription("Post a public summary of upcoming FullParty runs.")
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .addBooleanOption((option) =>
      option
        .setName("posthere")
        .setDescription(
          "Post in this channel instead of the configured Member-Facing Channel.",
        ),
    ),
  async execute(interaction, context) {
    if (!(await requireGuildBotModerator(interaction, context))) {
      return;
    }

    const guildId = interaction.guildId;

    if (!guildId) {
      throw new Error("Expected postruns interaction to include a guild id.");
    }

    const settings = await context.guildSettings.get(guildId);

    if (!settings.linkedAt) {
      await interaction.reply({
        content:
          "This Discord server is not linked to a FullParty group yet. Use `/link token:<code>` with a server link token from FullParty first.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const postHere = interaction.options.getBoolean("posthere") ?? false;
    let target: { channel: unknown; channelId: string | undefined };

    try {
      target = postHere
        ? { channel: interaction.channel, channelId: interaction.channelId }
        : await fetchConfiguredChannel(
            interaction.client,
            settings.runAnnouncementChannelId,
          );
    } catch (error) {
      context.logger.warn("Unable to inspect member-facing channel for postruns.", {
        channelId: settings.runAnnouncementChannelId,
        error,
        guildId,
      });
      await interaction.reply({
        content:
          "I could not inspect the configured Member-Facing Channel. Check that I can view it, or run `/postruns posthere:true` somewhere I can post.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!target.channelId) {
      await interaction.reply({
        content:
          "No Member-Facing Channel is configured yet. Run `/setup` and choose one, or run `/postruns posthere:true` to post in this channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!isSendableChannel(target.channel)) {
      await interaction.reply({
        content: `I cannot send messages in <#${target.channelId}>. Check that I can view and send messages there, or run \`/postruns posthere:true\` somewhere I can post.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let message: MessageCreateOptions;

    try {
      const runs = await captureFullpartyCommandPayload({
        commandName: "postruns",
        discordGuildId: guildId,
        payloads: context.payloads,
        request: () =>
          context.fullparty.getDiscordGuildUpcomingRuns(guildId, { limit: defaultLimit }),
      });

      message = createGuildUpcomingRunsPostMessage(runs, context.fullpartyWebBaseUrl);
    } catch (error) {
      context.logger.warn("Unable to fetch FullParty runs for public post.", {
        error,
        guildId,
      });
      await interaction.editReply({
        content:
          "I could not reach FullParty for the upcoming runs list right now. Please try again in a moment.",
      });
      return;
    }

    try {
      await target.channel.send(message);
    } catch (error) {
      context.logger.warn("Unable to post upcoming runs message.", {
        channelId: target.channelId,
        error,
        guildId,
      });
      await interaction.editReply({
        content: `I could not post in <#${target.channelId}>. Check that I can view and send messages there, then try again.`,
      });
      return;
    }

    await interaction.editReply({
      content: postHere
        ? "Posted the upcoming runs summary in this channel."
        : `Posted the upcoming runs summary in <#${target.channelId}>.`,
    });
  },
};

async function fetchConfiguredChannel(
  client: { channels: { fetch(id: string): Promise<unknown> } },
  channelId: string | undefined,
): Promise<{ channel: unknown; channelId: string | undefined }> {
  if (!channelId) {
    return {
      channel: undefined,
      channelId: undefined,
    };
  }

  return {
    channel: await client.channels.fetch(channelId),
    channelId,
  };
}

type SendableChannel = {
  send(message: MessageCreateOptions): Promise<unknown>;
};

function isSendableChannel(value: unknown): value is SendableChannel {
  return isRecord(value) && typeof value.send === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
