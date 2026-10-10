import {
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  MessageFlags,
} from "discord.js";

import type { BotContext } from "../bot/context.js";
import { CommandError } from "../commands/commandError.js";
import { getCommandMap, getComponentCommand } from "../commands/index.js";
import type { ChatInputCommand, SetupComponentInteraction } from "../commands/types.js";
import { createAccountLinkRequiredMessage } from "../discord/linkMessages.js";
import { FullpartyApiError } from "../fullparty/client.js";
import {
  isAutomationFailureDetailsCustomId,
  replyWithAutomationFailureDetails,
} from "../guildAutomation/automationFailureDetails.js";
import { isExpectedDiscordFailure } from "../health/errorReporter.js";
import { recordFailureSafely, serializeFailureError } from "../health/failureReporter.js";
import { bestEffort } from "../lib/bestEffort.js";
import { getDiscordApiErrorCode } from "../lib/errors.js";
import { jsonPreviewCustomIdPrefix } from "../dev/jsonPreview.js";

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

    if (
      ((typeof interaction.isButton === "function" && interaction.isButton()) ||
        (typeof interaction.isAnySelectMenu === "function" &&
          interaction.isAnySelectMenu())) &&
      interaction.customId.startsWith(jsonPreviewCustomIdPrefix)
    ) {
      await interaction.reply({
        content:
          context.developmentJsonEnabled &&
          interaction.user.id === context.payloadCommandAllowedUserId
            ? "This is a JSON preview. The control does not perform a bot action."
            : "That preview control is not available.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (
      typeof interaction.isButton === "function" &&
      interaction.isButton() &&
      isAutomationFailureDetailsCustomId(interaction.customId)
    ) {
      await handleAutomationFailureDetailsInteraction(interaction);
      return;
    }

    if (isSetupComponentInteraction(interaction)) {
      await handleComponentInteraction(interaction, context, availableCommands);
    }
  };
}

async function handleAutomationFailureDetailsInteraction(
  interaction: ButtonInteraction,
): Promise<void> {
  await replyWithAutomationFailureDetails(interaction);
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
    const diagnostics = getInteractionDiagnostics(interaction, startedAt);
    recordCommandUsage(context, {
      commandName: interaction.commandName,
      discordGuildId: interaction.guildId,
      discordUserId: interaction.user.id,
      durationMs: diagnostics.handlerElapsedMs,
      errorCode: getCommandErrorCode(error),
      status: "failed",
    });
    context.logger.error("Command execution failed.", {
      commandName: interaction.commandName,
      ...diagnostics,
      error,
    });
    recordFailureSafely(context.failureReporter, context.logger, {
      action: interaction.commandName,
      affectsHealth:
        error instanceof CommandError
          ? error.affectsHealth
          : !isExpectedDiscordFailure(error),
      details: {
        ...diagnostics,
        error: serializeFailureError(error),
      },
      discordGuildId: interaction.guildId ?? undefined,
      discordUserId: interaction.user.id,
      errorCode: getCommandErrorCode(error),
      message: getErrorMessage(error),
      severity: "error",
      source: "command",
    });
    await replyWithError(interaction, error, context);
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
  bestEffort(context.logger, "Unable to record admin command telemetry.", () =>
    context.adminStore?.recordCommandUsage(input),
  );
}

async function handleComponentInteraction(
  interaction: SetupComponentInteraction,
  context: BotContext,
  availableCommands: readonly ChatInputCommand[] | undefined,
): Promise<void> {
  const startedAt = Date.now();
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
    const diagnostics = getInteractionDiagnostics(interaction, startedAt);
    context.logger.error("Component interaction failed.", {
      customId: interaction.customId,
      ...diagnostics,
      error,
    });
    recordFailureSafely(context.failureReporter, context.logger, {
      action: interaction.customId,
      affectsHealth:
        error instanceof CommandError
          ? error.affectsHealth
          : !isExpectedDiscordFailure(error),
      details: {
        ...diagnostics,
        error: serializeFailureError(error),
      },
      discordGuildId: interaction.guildId ?? undefined,
      discordUserId: interaction.user.id,
      errorCode: getCommandErrorCode(error),
      message: getErrorMessage(error),
      severity: "error",
      source: "component",
    });
    await replyWithError(interaction, error, context);
  }
}

function isSetupComponentInteraction(
  interaction: Interaction,
): interaction is SetupComponentInteraction {
  return (
    (typeof interaction.isButton === "function" && interaction.isButton()) ||
    (typeof interaction.isChannelSelectMenu === "function" &&
      interaction.isChannelSelectMenu()) ||
    (typeof interaction.isRoleSelectMenu === "function" &&
      interaction.isRoleSelectMenu()) ||
    (typeof interaction.isStringSelectMenu === "function" &&
      interaction.isStringSelectMenu())
  );
}

async function replyWithError(
  interaction: ChatInputCommandInteraction | SetupComponentInteraction,
  error: unknown,
  context: BotContext,
): Promise<void> {
  // Discord has invalidated this interaction. Another response cannot recover it.
  if (getDiscordApiErrorCode(error) === "10062") return;

  try {
    await sendErrorReply(interaction, error);
  } catch (replyError) {
    if (getDiscordApiErrorCode(replyError) !== "10062") throw replyError;

    // Keep the original command/component failure; do not count an expired
    // fallback response as another failed operation.
    context.logger.warn("Interaction expired before the error reply could be sent.", {
      interactionId: interaction.id,
      errorCode: "10062",
    });
  }
}

function getInteractionDiagnostics(
  interaction: ChatInputCommandInteraction | SetupComponentInteraction,
  startedAt: number,
) {
  const now = Date.now();
  const createdAt = interaction.createdTimestamp;
  const hasTimestamp = Number.isFinite(createdAt);

  return {
    interactionId: interaction.id,
    processId: process.pid,
    interactionAgeAtStartMs: hasTimestamp ? startedAt - createdAt : null,
    interactionAgeAtFailureMs: hasTimestamp ? now - createdAt : null,
    handlerElapsedMs: now - startedAt,
    deferred: interaction.deferred,
    replied: interaction.replied,
  };
}

async function sendErrorReply(
  interaction: ChatInputCommandInteraction | SetupComponentInteraction,
  error: unknown,
): Promise<void> {
  const message =
    error instanceof CommandError
      ? { content: error.publicMessage }
      : isUnlinkedDiscordUserError(error)
        ? createLinkedUserRequiredMessage()
        : { content: "Something went wrong while running that command." };
  const flags = MessageFlags.Ephemeral | ("flags" in message ? message.flags : 0);

  if (interaction.deferred && "customId" in interaction) {
    await interaction.followUp({ ...message, flags });
    return;
  }

  if (interaction.deferred) {
    await interaction.editReply({
      ...message,
      ...("flags" in message ? { content: null, embeds: [] } : {}),
    });
    return;
  }

  if (interaction.replied) {
    await interaction.followUp({
      ...message,
      flags,
    });
    return;
  }

  await interaction.reply({
    ...message,
    flags,
  });
}

function createLinkedUserRequiredMessage() {
  return createAccountLinkRequiredMessage();
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

  return (
    getDiscordApiErrorCode(error) ?? (error instanceof Error ? error.name : undefined)
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
