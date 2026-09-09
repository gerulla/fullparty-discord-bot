import type { Client } from "discord.js";
import type { BotContext } from "../bot/context.js";

export type GuildIntegrationOptions = {
  client: Client;
  context: Pick<
    BotContext,
    | "guildSettings"
    | "guildRunRoles"
    | "guildMemberCache"
    | "guildMemberCacheScheduler"
    | "logger"
  >;
};
