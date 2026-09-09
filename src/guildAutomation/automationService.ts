import { sendBotLogMessage } from "./messages.js";
import { syncRunReminderNicknames } from "./nicknameSync.js";
import { buildGuildRunAutomationStartedMessage } from "./presentation/common.js";
import type {
  RoleAssignmentResult,
  RoleCleanupResult,
  RunReminderResult,
} from "./results.js";
import { assignUpcomingRaiderRole } from "./roleAssignment.js";
import { deleteRunRole } from "./roleCleanup.js";
import type { GuildRunCompletedData, GuildRunReminderData } from "./runReminderTypes.js";
import {
  recordCleanupAutomationTelemetry,
  recordRoleAssignmentAutomationTelemetry,
  recordRunReminderAutomationTelemetry,
} from "./telemetry.js";
import type {
  GuildAutomationProcessorOptions,
  RoleAssignmentProcessorOptions,
} from "./types.js";

export class GuildAutomationService {
  public constructor(private readonly dependencies: GuildAutomationProcessorOptions) {}

  public async remind(data: GuildRunReminderData): Promise<RunReminderResult> {
    const options = this.dependencies;
    const settings = await options.context.guildSettings.get(data.discord_guild_id);
    const result = {
      ...(await assignUpcomingRaiderRole(options, data, settings)),
      ...(await syncRunReminderNicknames(options, data, settings)),
    };

    recordRunReminderAutomationTelemetry(options, data, result);

    return result;
  }

  public async notifyStarted(data: GuildRunReminderData): Promise<void> {
    const options = this.dependencies;
    const settings = await options.context.guildSettings.get(data.discord_guild_id);

    await sendBotLogMessage(
      options,
      settings.botLogChannelId,
      buildGuildRunAutomationStartedMessage(data),
      {
        discordGuildId: data.discord_guild_id,
        messageType: "guild_run_automation_started",
      },
    );
  }

  public async assignRole(
    data: GuildRunReminderData,
    processorOptions: RoleAssignmentProcessorOptions = {},
  ): Promise<RoleAssignmentResult> {
    const options = this.dependencies;
    const settings = await options.context.guildSettings.get(data.discord_guild_id);
    const result = await assignUpcomingRaiderRole(
      options,
      data,
      settings,
      processorOptions,
    );

    recordRoleAssignmentAutomationTelemetry(options, data, result);

    return result;
  }

  public async complete(data: GuildRunCompletedData): Promise<RoleCleanupResult> {
    const options = this.dependencies;
    const settings = await options.context.guildSettings.get(data.discord_guild_id);
    const result = await deleteRunRole(options, data, settings);

    recordCleanupAutomationTelemetry(options, data, result);

    return result;
  }
}
