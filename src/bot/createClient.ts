import { Client, Events, GatewayIntentBits, Partials } from "discord.js";

import type { BotContext } from "./context.js";
import { createInteractionHandler } from "../interactions/handleInteraction.js";

export function createBotClient(context: BotContext): Client {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
    partials: [Partials.Channel],
  });

  client.once(Events.ClientReady, (readyClient) => {
    context.logger.info("Discord client is ready.", {
      applicationId: readyClient.application.id,
      userTag: readyClient.user.tag,
    });
  });

  client.on(Events.InteractionCreate, createInteractionHandler(context));

  return client;
}
