import { Client, Events, GatewayIntentBits, Partials, type Message } from "discord.js";

import { runReportedTask } from "../health/errorReporter.js";
import { createInteractionHandler } from "../interactions/handleInteraction.js";
import type { BotContext } from "./context.js";

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

  const handleInteraction = createInteractionHandler(context);
  client.on(Events.InteractionCreate, (interaction) => {
    void runReportedTask(
      context,
      {
        source: "discord_api",
        action: "interaction_response",
        discordGuildId: interaction.guildId ?? undefined,
        discordUserId: interaction.user.id,
      },
      () => handleInteraction(interaction),
    );
  });
  client.on(Events.MessageCreate, (message) => {
    void runReportedTask(
      context,
      {
        source: "discord_api",
        action: "direct_message_response",
        discordUserId: message.author.id,
      },
      () => handleMessageCreate(message, context),
    );
  });
  client.on(Events.GuildMemberAdd, (member) => {
    if (member.user.bot) {
      return;
    }

    void runReportedTask(
      context,
      {
        source: "guild_membership",
        action: "member_joined",
        discordGuildId: member.guild.id,
        discordUserId: member.id,
      },
      () => context.guildMemberCache?.markMemberSeen(member.guild.id, member.id),
    );
  });
  client.on(Events.GuildMemberRemove, (member) => {
    void runReportedTask(
      context,
      {
        source: "guild_membership",
        action: "member_removed",
        discordGuildId: member.guild.id,
        discordUserId: member.id,
      },
      () => context.guildMemberCache?.markMemberRemoved(member.guild.id, member.id),
    );
  });
  client.on(Events.GuildCreate, (guild) => {
    void runReportedTask(
      context,
      { source: "guild_membership", action: "guild_joined", discordGuildId: guild.id },
      () => context.guildMemberCacheScheduler?.enqueueRefresh(guild.id, "guild_joined"),
    );
  });
  client.on(Events.GuildDelete, (guild) => {
    void runReportedTask(
      context,
      { source: "guild_membership", action: "guild_removed", discordGuildId: guild.id },
      () => context.guildMemberCache?.markGuildObsolete(guild.id),
    );
  });

  client.on(Events.Error, (error) => {
    void runReportedTask(
      context,
      { source: "discord_api", action: "client_error" },
      () => {
        throw error;
      },
    );
  });
  client.on(Events.ShardError, (error) => {
    void runReportedTask(
      context,
      { source: "discord_api", action: "gateway_error" },
      () => {
        throw error;
      },
    );
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
