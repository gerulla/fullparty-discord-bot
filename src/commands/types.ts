import type {
  ButtonInteraction,
  ChannelSelectMenuInteraction,
  ChatInputCommandInteraction,
  RoleSelectMenuInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";

import type { BotContext } from "../bot/context.js";

export type SlashCommandData =
  | SlashCommandBuilder
  | SlashCommandOptionsOnlyBuilder
  | SlashCommandSubcommandsOnlyBuilder;

export type ChatInputCommand = {
  componentCustomIdPrefix?: string;
  data: SlashCommandData;
  execute(interaction: ChatInputCommandInteraction, context: BotContext): Promise<void>;
  handleComponent?(
    interaction: SetupComponentInteraction,
    context: BotContext,
  ): Promise<void>;
};

export type SetupComponentInteraction =
  | ButtonInteraction
  | ChannelSelectMenuInteraction
  | RoleSelectMenuInteraction;
