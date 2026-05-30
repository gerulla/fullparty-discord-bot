import { REST, Routes } from "discord.js";

import { getCommandData } from "../commands/index.js";
import { parseConfig } from "../config/env.js";

const config = parseConfig();
const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);
const commands = getCommandData();

const target = getRegistrationTarget();

try {
  await rest.put(target.route, { body: commands });

  console.log(`Registered ${String(commands.length)} command(s) for ${target.scope}.`);

  if (target.kind === "guild") {
    console.warn(
      "User-installed apps require global commands. Use global scope before release.",
    );
  }
} catch (error) {
  if (isDiscordMissingAccessError(error)) {
    console.error(buildMissingAccessMessage(target));
    process.exitCode = 1;
  } else {
    throw error;
  }
}

function getRegistrationTarget() {
  const scope = getRegistrationScope();

  if (scope === "guild") {
    const guildId = config.DISCORD_GUILD_ID;

    if (!guildId) {
      throw new Error(
        "DISCORD_GUILD_ID is required when DISCORD_COMMAND_REGISTER_SCOPE is guild.",
      );
    }

    return {
      guildId,
      kind: "guild" as const,
      route: Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, guildId),
      scope: `guild ${guildId}`,
    };
  }

  return {
    kind: "global" as const,
    route: Routes.applicationCommands(config.DISCORD_CLIENT_ID),
    scope: "global",
  };
}

function getRegistrationScope(): "global" | "guild" {
  if (process.argv.includes("--global")) {
    return "global";
  }

  if (process.argv.includes("--guild")) {
    return "guild";
  }

  return config.DISCORD_COMMAND_REGISTER_SCOPE;
}

function isDiscordMissingAccessError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }

  return error.code === 50001 && error.status === 403;
}

function buildMissingAccessMessage(target: ReturnType<typeof getRegistrationTarget>) {
  if (target.kind === "global") {
    return [
      "Discord returned 50001 Missing Access while registering global commands.",
      "Check that DISCORD_TOKEN belongs to the application in DISCORD_CLIENT_ID.",
    ].join("\n");
  }

  return [
    `Discord returned 50001 Missing Access while registering commands for guild ${target.guildId}.`,
    "Install the application into that server first, then rerun npm run commands:deploy.",
    `Guild install URL: ${buildGuildInstallUrl()}`,
    "Also confirm Guild Install is enabled in the Discord Developer Portal Installation settings.",
  ].join("\n");
}

function buildGuildInstallUrl(): string {
  const url = new URL("https://discord.com/oauth2/authorize");

  url.searchParams.set("client_id", config.DISCORD_CLIENT_ID);
  url.searchParams.set("scope", "bot applications.commands");
  url.searchParams.set("permissions", "0");
  url.searchParams.set("integration_type", "0");

  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
