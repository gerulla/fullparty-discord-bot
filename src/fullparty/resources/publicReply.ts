import type { ChatInputCommandInteraction } from "discord.js";
import type { Logger } from "../../lib/logger.js";
import type { ResourceMessage } from "./messages.js";

export async function postPublicResourceReply(
  interaction: ChatInputCommandInteraction,
  message: ResourceMessage,
  logger: Logger,
): Promise<void> {
  // Complete the private defer first; a direct followUp would inherit its visibility.
  await interaction.editReply({ content: "Posting resources in this channel..." });
  await interaction.followUp(message);
  try {
    await interaction.deleteReply();
  } catch (error) {
    // The public post succeeded. Do not report it as failed and encourage duplicate posts.
    logger.warn("Unable to remove the private /info acknowledgement.", { error });
  }
}
