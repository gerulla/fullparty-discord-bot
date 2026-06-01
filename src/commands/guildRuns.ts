import {
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";

import { captureFullpartyCommandPayload } from "../fullparty/commandPayloadCapture.js";
import {
  createGuildUpcomingRunsMessage,
  type GuildUpcomingRunsPaginationOptions,
} from "../fullparty/discordGuildMessages.js";
import { runGuildRunRoleAssignment } from "./assignRunRole.js";
import { requireGuildBotModerator } from "./guildCommandAccess.js";
import type { ChatInputCommand } from "./types.js";

const componentPrefix = "guildruns";

export const guildRunsCommand: ChatInputCommand = {
  componentCustomIdPrefix: componentPrefix,
  data: new SlashCommandBuilder()
    .setName("guildruns")
    .setDescription("Show upcoming FullParty runs for this Discord server.")
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription("How many upcoming runs to fetch from FullParty.")
        .setMinValue(1)
        .setMaxValue(100),
    ),
  async execute(interaction, context) {
    if (!(await requireGuildBotModerator(interaction, context))) {
      return;
    }

    const guildId = interaction.guildId;

    if (!guildId) {
      throw new Error("Expected guildruns interaction to include a guild id.");
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

    await interaction.deferReply();

    const limit = interaction.options.getInteger("limit") ?? 25;
    const runs = await captureFullpartyCommandPayload({
      commandName: "guildruns",
      discordGuildId: guildId,
      payloads: context.payloads,
      request: () => context.fullparty.getDiscordGuildUpcomingRuns(guildId, { limit }),
    });

    await interaction.editReply(
      createGuildUpcomingRunsMessage(runs, context.fullpartyWebBaseUrl, {
        guildId,
        limit,
        page: 0,
        requesterId: interaction.user.id,
      }),
    );
  },
  async handleComponent(interaction, context) {
    if (!interaction.isButton()) {
      return;
    }

    const component = parseGuildRunsComponentCustomId(interaction.customId);

    if (component?.pagination.guildId !== interaction.guildId) {
      await interaction.reply({
        content: "That guild runs control is no longer valid.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { pagination } = component;

    if (pagination.requesterId !== interaction.user.id) {
      await interaction.reply({
        content: "Only the person who ran `/guildruns` can change this page.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (component.action === "assign") {
      const settings = await context.guildSettings.get(pagination.guildId);

      if (!settings.linkedAt) {
        await interaction.reply({
          content:
            "This Discord server is not linked to a FullParty group anymore. Use `/link token:<code>` with a server link token from FullParty first.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferReply();
      await runGuildRunRoleAssignment({
        client: interaction.client,
        context,
        guildId: pagination.guildId,
        responder: interaction,
        runId: component.runId,
      });
      return;
    }

    await interaction.deferUpdate();

    const response = await context.fullparty.getDiscordGuildUpcomingRuns(
      pagination.guildId,
      { limit: pagination.limit },
    );

    await interaction.editReply(
      createGuildUpcomingRunsMessage(response, context.fullpartyWebBaseUrl, pagination),
    );
  },
};

type GuildRunsComponent =
  | {
      action: "assign";
      pagination: GuildUpcomingRunsPaginationOptions;
      runId: number;
    }
  | {
      action: "page";
      pagination: GuildUpcomingRunsPaginationOptions;
    };

function parseGuildRunsComponentCustomId(
  customId: string,
): GuildRunsComponent | undefined {
  const [prefix, secondPart, thirdPart, fourthPart, fifthPart, sixthPart, ...extraParts] =
    customId.split(":");

  if (prefix !== componentPrefix) {
    return undefined;
  }

  if (secondPart === "assign") {
    if (
      !thirdPart ||
      !fourthPart ||
      !fifthPart ||
      !sixthPart ||
      extraParts.length !== 1
    ) {
      return undefined;
    }

    const pagination = parsePaginationParts(thirdPart, fourthPart, fifthPart, sixthPart);
    const runId = Number(extraParts[0]);

    return pagination && Number.isInteger(runId) && runId > 0
      ? {
          action: "assign",
          pagination,
          runId,
        }
      : undefined;
  }

  if (!secondPart || !thirdPart || !fourthPart || !fifthPart || extraParts.length > 0) {
    return undefined;
  }

  const pagination = parsePaginationParts(secondPart, thirdPart, fourthPart, fifthPart);

  return pagination
    ? {
        action: "page",
        pagination,
      }
    : undefined;
}

function parsePaginationParts(
  guildId: string,
  requesterId: string,
  limitValue: string,
  pageValue: string,
): GuildUpcomingRunsPaginationOptions | undefined {
  const limit = Number(limitValue);
  const page = Number(pageValue);

  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isInteger(page) ||
    page < 0
  ) {
    return undefined;
  }

  return {
    guildId,
    limit,
    page,
    requesterId,
  };
}
