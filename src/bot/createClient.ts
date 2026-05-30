import { Client, Events, GatewayIntentBits, Partials } from "discord.js";

import type { BotContext } from "./context.js";
import { createInteractionHandler } from "../interactions/handleInteraction.js";

export function createBotClient(context: BotContext): Client {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    partials: [Partials.Channel],
  });

  client.once(Events.ClientReady, (readyClient) => {
    context.logger.info("Discord client is ready.", {
      applicationId: readyClient.application.id,
      userTag: readyClient.user.tag,
    });
  });

  client.on(Events.InteractionCreate, createInteractionHandler(context));
  client.on(Events.GuildMemberAdd, (member) => {
    void context.guildMemberCache
      ?.markMemberSeen(member.guild.id, member.id)
      .catch((error: unknown) => {
        context.logger.warn("Unable to cache guild member join.", {
          discordGuildId: member.guild.id,
          discordUserId: member.id,
          error,
        });
      });
  });
  client.on(Events.GuildMemberRemove, (member) => {
    void context.guildMemberCache
      ?.markMemberRemoved(member.guild.id, member.id)
      .catch((error: unknown) => {
        context.logger.warn("Unable to cache guild member removal.", {
          discordGuildId: member.guild.id,
          discordUserId: member.id,
          error,
        });
      });
  });
  client.on(Events.GuildCreate, (guild) => {
    void context.guildMemberCacheScheduler?.enqueueRefresh(guild.id, "guild_joined");
  });
  client.on(Events.GuildDelete, (guild) => {
    void context.guildMemberCache?.deleteGuild(guild.id).catch((error: unknown) => {
      context.logger.warn("Unable to purge guild member cache after guild removal.", {
        discordGuildId: guild.id,
        error,
      });
    });
  });

  return client;
}
