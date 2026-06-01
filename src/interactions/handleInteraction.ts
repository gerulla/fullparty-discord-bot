import {
  type ChatInputCommandInteraction,
  type Interaction,
  MessageFlags,
} from "discord.js";

import type { BotContext } from "../bot/context.js";
import { getCommandMap, getComponentCommand } from "../commands/index.js";
import type { ChatInputCommand, SetupComponentInteraction } from "../commands/types.js";
import { FullpartyApiError } from "../fullparty/client.js";
import { recordFailureSafely, serializeFailureError } from "../health/failureReporter.js";

export function createInteractionHandler(
  context: BotContext,
  availableCommands?: readonly ChatInputCommand[],
) {
  const commandMap = getCommandMap(availableCommands);

  return async (interaction: Interaction) => {
    if (interaction.isChatInputCommand()) {
      await handleChatInputCommand(interaction, context, commandMap);
      return;
    }

    if (isSetupComponentInteraction(interaction)) {
      await handleComponentInteraction(interaction, context, availableCommands);
    }
  };
}

async function handleChatInputCommand(
  interaction: ChatInputCommandInteraction,
  context: BotContext,
  commandMap: Map<string, ChatInputCommand>,
): Promise<void> {
  const startedAt = Date.now();
  const command = commandMap.get(interaction.commandName);

  if (!command) {
    context.logger.warn("Received an unknown command interaction.", {
      commandName: interaction.commandName,
    });
    await interaction.reply({
      content: "That command is not available.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await command.execute(interaction, context);
    recordCommandUsage(context, {
      commandName: interaction.commandName,
      discordGuildId: interaction.guildId,
      discordUserId: interaction.user.id,
      durationMs: Date.now() - startedAt,
      status: "succeeded",
    });
  } catch (error) {
    recordCommandUsage(context, {
      commandName: interaction.commandName,
      discordGuildId: interaction.guildId,
      discordUserId: interaction.user.id,
      durationMs: Date.now() - startedAt,
      errorCode: getCommandErrorCode(error),
      status: "failed",
    });
    context.logger.error("Command execution failed.", {
      commandName: interaction.commandName,
      error,
    });
    recordFailureSafely(context.failureReporter, context.logger, {
      action: interaction.commandName,
      details: {
        error: serializeFailureError(error),
      },
      discordGuildId: interaction.guildId ?? undefined,
      discordUserId: interaction.user.id,
      errorCode: getCommandErrorCode(error),
      message: getErrorMessage(error),
      severity: "error",
      source: "command",
    });
    await replyWithError(interaction, error, context.fullpartyWebBaseUrl);
  }
}

function recordCommandUsage(
  context: BotContext,
  input: {
    commandName: string;
    discordGuildId: string | null;
    discordUserId: string;
    durationMs: number;
    errorCode?: string | undefined;
    status: "succeeded" | "failed";
  },
): void {
  void context.adminStore?.recordCommandUsage(input).catch((error: unknown) => {
    context.logger.warn("Unable to record admin command telemetry.", { error });
  });
}

async function handleComponentInteraction(
  interaction: SetupComponentInteraction,
  context: BotContext,
  availableCommands: readonly ChatInputCommand[] | undefined,
): Promise<void> {
  const command = getComponentCommand(interaction.customId, availableCommands);

  if (!command?.handleComponent) {
    context.logger.warn("Received an unknown component interaction.", {
      customId: interaction.customId,
    });
    await interaction.reply({
      content: "That setup control is no longer available.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await command.handleComponent(interaction, context);
  } catch (error) {
    context.logger.error("Component interaction failed.", {
      customId: interaction.customId,
      error,
    });
    recordFailureSafely(context.failureReporter, context.logger, {
      action: interaction.customId,
      details: {
        error: serializeFailureError(error),
      },
      discordGuildId: interaction.guildId ?? undefined,
      discordUserId: interaction.user.id,
      errorCode: getCommandErrorCode(error),
      message: getErrorMessage(error),
      severity: "error",
      source: "component",
    });
    await replyWithError(interaction, error, context.fullpartyWebBaseUrl);
  }
}

function isSetupComponentInteraction(
  interaction: Interaction,
): interaction is SetupComponentInteraction {
  return (
    (typeof interaction.isButton === "function" && interaction.isButton()) ||
    (typeof interaction.isChannelSelectMenu === "function" &&
      interaction.isChannelSelectMenu()) ||
    (typeof interaction.isRoleSelectMenu === "function" && interaction.isRoleSelectMenu())
  );
}

async function replyWithError(
  interaction: ChatInputCommandInteraction | SetupComponentInteraction,
  error: unknown,
  fullpartyWebBaseUrl: string,
): Promise<void> {
  const content = isUnlinkedDiscordUserError(error)
    ? createLinkedUserRequiredMessage(fullpartyWebBaseUrl)
    : "Something went wrong while running that command.";

  if (interaction.deferred) {
    await interaction.editReply({ content });
    return;
  }

  if (interaction.replied) {
    await interaction.followUp({
      content,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content,
    flags: MessageFlags.Ephemeral,
  });
}

function createLinkedUserRequiredMessage(fullpartyWebBaseUrl: string): string {
  return [
    "Your Discord account is not linked to FullParty yet.",
    `Open ${fullpartyWebBaseUrl}, go to your user settings, and generate a Discord link code.`,
    "Then come back here and run `/link token:<code>` to connect your account.",
  ].join("\n\n");
}

function isUnlinkedDiscordUserError(error: unknown): boolean {
  if (!(error instanceof FullpartyApiError)) {
    return false;
  }

  const bodyText = normalizeErrorText(
    [error.message, ...collectErrorText(error.body)].join(" "),
  );

  if (isRouteNotFoundError(bodyText)) {
    return false;
  }

  return unlinkedDiscordUserPatterns.some((pattern) => pattern.test(bodyText));
}

function normalizeErrorText(value: string): string {
  return value.toLowerCase().replaceAll(/[_-]+/gu, " ");
}

function isRouteNotFoundError(bodyText: string): boolean {
  return (
    /route\s+.+could\s+not\s+be\s+found/u.test(bodyText) ||
    bodyText.includes("notfoundhttpexception")
  );
}

function collectErrorText(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectErrorText);
  }

  if (typeof value !== "object" || value === null) {
    return [];
  }

  return Object.entries(value).flatMap(([key, nestedValue]) => [
    key,
    ...collectErrorText(nestedValue),
  ]);
}

const unlinkedDiscordUserPatterns = [
  /discord\s+user\s+not\s+linked/u,
  /discord\s+account\s+not\s+linked/u,
  /not\s+linked\s+to\s+fullparty/u,
  /not\s+linked\s+.+discord/u,
  /no\s+linked\s+discord/u,
  /no\s+discord\s+link/u,
  /discord\s+link\s+required/u,
  /linked\s+discord\s+user\s+.+not\s+(?:be\s+)?found/u,
  /discord\s+user\s+.+not\s+(?:be\s+)?found/u,
];

function getCommandErrorCode(error: unknown): string | undefined {
  if (error instanceof FullpartyApiError) {
    return `fullparty_api_${String(error.status)}`;
  }

  return error instanceof Error ? error.name : undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
