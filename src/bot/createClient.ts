import { Client, Events, GatewayIntentBits, Partials, type Message } from "discord.js";

import type { BotContext } from "./context.js";
import { createInteractionHandler } from "../interactions/handleInteraction.js";

export function createBotClient(context: BotContext): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
  });

  client.once(Events.ClientReady, (readyClient) => {
    context.logger.info("Discord client is ready.", {
      applicationId: readyClient.application.id,
      userTag: readyClient.user.tag,
    });
  });

  client.on(Events.InteractionCreate, createInteractionHandler(context));
  client.on(Events.MessageCreate, (message) => {
    void handleMessageCreate(message, context);
  });
  client.on(Events.GuildMemberAdd, (member) => {
    if (member.user.bot) {
      return;
    }

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
    void context.guildMemberCache?.markGuildObsolete(guild.id).catch((error: unknown) => {
      context.logger.warn(
        "Unable to mark guild member cache obsolete after guild removal.",
        {
          discordGuildId: guild.id,
          error,
        },
      );
    });
  });

  return client;
}

async function handleMessageCreate(message: Message, context: BotContext): Promise<void> {
  if (message.author.bot || message.content.trim().toLowerCase() !== "!token") {
    return;
  }

  if (message.inGuild()) {
    return;
  }

  if (!context.payloadCommandAllowedUserId) {
    await message.reply(
      "Admin token delivery is not configured. Set `PAYLOAD_COMMAND_ALLOWED_USER_ID` first.",
    );
    return;
  }

  if (message.author.id !== context.payloadCommandAllowedUserId) {
    await message.reply("This admin token is only available to the configured owner.");
    return;
  }

  if (!context.adminApiToken) {
    await message.reply("`ADMIN_API_TOKEN` is not configured for this bot.");
    return;
  }

  await message.reply({
    content: [
      "Here is your FullParty bot admin API token:",
      `\`\`\`\n${context.adminApiToken}\n\`\`\``,
      "Use it on the admin dashboard login page. Treat it like a password.",
    ].join("\n\n"),
  });
}
