import {
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";

import { captureFullpartyCommandPayload } from "../fullparty/commandPayloadCapture.js";
import { FullpartyApiError } from "../fullparty/client.js";
import { extractGuildRunReminderData } from "../fullparty/guildRunAssignmentPayload.js";
import { processGuildRunRoleAssignment } from "../http/server.js";
import { formatDiscordDateTime } from "../lib/discordTimestamps.js";
import { requireGuildBotModerator } from "./guildCommandAccess.js";
import type { ChatInputCommand } from "./types.js";

const maxBeforeStartMs = 60 * 60 * 1000;
const maxAfterStartMs = 15 * 60 * 1000;

export const assignRunRoleCommand: ChatInputCommand = {
  data: new SlashCommandBuilder()
    .setName("assignrunrole")
    .setDescription("Manually assign the temporary FullParty role for a run.")
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((option) =>
      option
        .setName("run_id")
        .setDescription("The FullParty run ID to assign roles for.")
        .setMinValue(1)
        .setRequired(true),
    ),
  async execute(interaction, context) {
    if (!(await requireGuildBotModerator(interaction, context))) {
      return;
    }

    const guildId = interaction.guildId;

    if (!guildId) {
      throw new Error("Expected assignrunrole interaction to include a guild id.");
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

    const runId = interaction.options.getInteger("run_id", true);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const response = await fetchRunRoleAssignmentPayload(
      interaction,
      context,
      guildId,
      runId,
    );

    if (!response) {
      return;
    }

    let data;

    try {
      data = extractGuildRunReminderData(response, {
        discordGuildId: guildId,
        now: new Date(),
        runId,
      });
    } catch {
      await interaction.editReply({
        content:
          "FullParty did not return enough data for that run role assignment. I need the run id, start time, Discord guild id, and participants.",
      });
      return;
    }

    if (data.discord_guild_id !== guildId) {
      await interaction.editReply({
        content:
          "FullParty returned a role assignment payload for a different Discord server, so I did not run it.",
      });
      return;
    }

    const windowError = getRunAssignmentWindowError(data.starts_at);

    if (windowError) {
      await interaction.editReply({ content: windowError });
      return;
    }

    const result = await processGuildRunRoleAssignment(
      {
        client: interaction.client,
        context,
      },
      data,
    );

    await interaction.editReply({
      content: createAssignmentResultMessage(data.run_id, result, data),
    });
  },
};

async function fetchRunRoleAssignmentPayload(
  interaction: Parameters<ChatInputCommand["execute"]>[0],
  context: Parameters<ChatInputCommand["execute"]>[1],
  guildId: string,
  runId: number,
): Promise<unknown> {
  try {
    return await captureFullpartyCommandPayload({
      commandName: "assignrunrole",
      discordGuildId: guildId,
      payloads: context.payloads,
      request: () => context.fullparty.getDiscordGuildRunRoleAssignment(guildId, runId),
    });
  } catch (error) {
    await interaction.editReply({
      content: getFullpartyRunLookupErrorMessage(error, runId),
    });
    return undefined;
  }
}

function getRunAssignmentWindowError(startsAt: string | undefined): string | undefined {
  if (!startsAt) {
    return "FullParty did not return a start time for that run, so I could not safely assign the temporary role.";
  }

  const startsAtTime = Date.parse(startsAt);

  if (Number.isNaN(startsAtTime)) {
    return "FullParty returned an invalid start time for that run, so I could not safely assign the temporary role.";
  }

  const now = Date.now();
  const earliestAllowed = now - maxAfterStartMs;
  const latestAllowed = now + maxBeforeStartMs;
  const formattedStartsAt = formatDiscordDateTime(startsAt) ?? startsAt;

  if (startsAtTime < earliestAllowed) {
    return `Run role assignment is only allowed until 15 minutes after the run starts. This run started at ${formattedStartsAt}.`;
  }

  if (startsAtTime > latestAllowed) {
    return `Run role assignment is only allowed within 60 minutes before the run starts. This run starts at ${formattedStartsAt}.`;
  }

  return undefined;
}

function createAssignmentResultMessage(
  runId: number,
  result: Record<string, unknown>,
  data: Record<string, unknown>,
): string {
  const assignedUserCount = getNumber(result, "assignedUserCount");
  const requestedUserCount = getNumber(result, "requestedUserCount");
  const failedUserCount = getNumber(result, "failedUserCount");
  const totalPlacedCount = getNumber(data, "total_placed_count");
  const unlinkedCount = getNumber(data, "unlinked_count");
  const roleId = getString(result, "roleId");
  const roleName = getString(result, "roleName");
  const skippedReason = getString(result, "skippedReason");
  const roleLine = roleId
    ? `Run role: <@&${roleId}>${roleName ? ` (${roleName})` : ""}`
    : "Run role: not created";

  if (skippedReason) {
    return [
      `⚠️ Role assignment checked for Run #${String(runId)}, but nothing was assigned.`,
      roleLine,
      `Reason: ${humanizeSkippedReason(skippedReason)}`,
      "Check the bot-log channel for the full status embed.",
    ].join("\n");
  }

  return [
    `✅ Role assignment ran for Run #${String(runId)}.`,
    `Assigned ${String(assignedUserCount)}/${String(requestedUserCount)} users.`,
    totalPlacedCount > 0
      ? `Placed users: ${String(totalPlacedCount)} total${unlinkedCount > 0 ? `, ${String(unlinkedCount)} without linked Discord` : ""}.`
      : undefined,
    failedUserCount > 0 ? `Failed: ${String(failedUserCount)} users.` : undefined,
    roleLine,
    "Check the bot-log channel for the full status embed.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function getFullpartyRunLookupErrorMessage(error: unknown, runId: number): string {
  if (error instanceof FullpartyApiError && error.status === 404) {
    return `I could not find upcoming Run #${String(runId)} for this linked Discord server.`;
  }

  if (error instanceof FullpartyApiError && error.status === 403) {
    return "FullParty rejected the guild run request. Check that the integration API token has the required guild scope.";
  }

  return "I could not reach FullParty for that run right now. Please try again in a moment.";
}

function humanizeSkippedReason(reason: string): string {
  return reason.replaceAll("_", " ");
}

function getNumber(result: Record<string, unknown>, key: string): number {
  const value = result[key];

  return typeof value === "number" ? value : 0;
}

function getString(result: Record<string, unknown>, key: string): string | undefined {
  const value = result[key];

  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
