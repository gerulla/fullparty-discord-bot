import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";

import { applicationsCommand } from "./applications.js";
import { helpCommand } from "./help.js";
import { linkCommand } from "./link.js";
import { payloadCommand } from "./payload.js";
import { pingCommand } from "./ping.js";
import { runsCommand } from "./runs.js";
import { setupCommand } from "./setup.js";
import type { ChatInputCommand } from "./types.js";

// Fullparty management commands are parked until the API auth/endpoints are ready.
// import { fullpartyCommand } from "./fullparty.js";

export const commands = [
  applicationsCommand,
  helpCommand,
  linkCommand,
  pingCommand,
  payloadCommand,
  runsCommand,
  setupCommand,
] as const;

export function getCommandData(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return commands.map((command) => command.data.toJSON());
}

export function getCommandMap(
  availableCommands: readonly ChatInputCommand[] = commands,
): Map<string, ChatInputCommand> {
  return new Map(
    availableCommands.map((command) => [command.data.name, command] as const),
  );
}

export function getComponentCommand(
  customId: string,
  availableCommands: readonly ChatInputCommand[] = commands,
): ChatInputCommand | undefined {
  return availableCommands.find((command) => {
    const prefix = command.componentCustomIdPrefix;

    return prefix ? customId === prefix || customId.startsWith(`${prefix}:`) : false;
  });
}
