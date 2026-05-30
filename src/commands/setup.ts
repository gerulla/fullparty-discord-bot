import {
  ActionRowBuilder,
  ApplicationIntegrationType,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
} from "discord.js";

import type { GuildSettings } from "../guildSettings/types.js";
import type { ChatInputCommand, SetupComponentInteraction } from "./types.js";

const setupCustomIdPrefix = "setup";
type SetupActionRow =
  | ActionRowBuilder<ButtonBuilder>
  | ActionRowBuilder<ChannelSelectMenuBuilder>
  | ActionRowBuilder<RoleSelectMenuBuilder>;

const SetupCustomId = {
  BotLogChannel: "setup:bot_log_channel",
  BotModeratorRole: "setup:bot_moderator_role",
  NameSyncDisabled: "setup:name_sync:disabled",
  NameSyncEnabled: "setup:name_sync:enabled",
  RunAnnouncementChannel: "setup:run_announcement_channel",
  UpcomingRaiderRole: "setup:upcoming_raider_role",
} as const;

export const setupCommand: ChatInputCommand = {
  componentCustomIdPrefix: setupCustomIdPrefix,
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configure FullParty guild integration settings.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild),
  async execute(interaction, context) {
    const guildId = await getManageableGuildId(interaction);

    if (!guildId) {
      return;
    }

    const settings = await context.guildSettings.get(guildId);

    await interaction.reply({
      ...buildSetupPanel(settings),
      flags: MessageFlags.Ephemeral,
    });
  },
  async handleComponent(interaction, context) {
    const guildId = await getManageableGuildId(interaction);

    if (!guildId) {
      return;
    }

    const patch = getSettingsPatch(interaction);
    const settings = await context.guildSettings.update(guildId, patch);

    await interaction.update(buildSetupPanel(settings));
  },
};

function buildSetupPanel(settings: GuildSettings): {
  components: SetupActionRow[];
  content: string;
} {
  return {
    components: buildSetupComponents(settings),
    content: [
      "**FullParty Server Setup**",
      "",
      "1. Bot-log channel: " + formatChannel(settings.botLogChannelId),
      "2. Member-Facing Channel: " + formatChannel(settings.runAnnouncementChannelId),
      "3. Template Role: " + formatRole(settings.upcomingRaiderRoleId),
      "4. Bot moderator role: " + formatRole(settings.botModeratorRoleId),
      "5. Sync Discord names to FF14 character names: " +
        formatEnabled(settings.syncDiscordNamesToFf14),
      "",
      "Use the controls below from top to bottom. Changes save immediately.",
    ].join("\n"),
  };
}

function buildSetupComponents(settings: GuildSettings): SetupActionRow[] {
  const botLogChannelRow = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(SetupCustomId.BotLogChannel)
      .setPlaceholder("1. Choose bot-log channel")
      .setMinValues(1)
      .setMaxValues(1)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
  );
  const runAnnouncementChannelRow =
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(SetupCustomId.RunAnnouncementChannel)
        .setPlaceholder("2. Choose Member-Facing Channel")
        .setMinValues(1)
        .setMaxValues(1)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    );
  const upcomingRaiderRoleRow =
    new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(SetupCustomId.UpcomingRaiderRole)
        .setPlaceholder("3. Choose Template Role")
        .setMinValues(1)
        .setMaxValues(1),
    );
  const botModeratorRoleRow = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId(SetupCustomId.BotModeratorRole)
      .setPlaceholder("4. Choose bot moderator role")
      .setMinValues(1)
      .setMaxValues(1),
  );
  const nameSyncRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(SetupCustomId.NameSyncEnabled)
      .setLabel("Enable name sync")
      .setStyle(ButtonStyle.Success)
      .setDisabled(settings.syncDiscordNamesToFf14),
    new ButtonBuilder()
      .setCustomId(SetupCustomId.NameSyncDisabled)
      .setLabel("Disable name sync")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!settings.syncDiscordNamesToFf14),
  );

  return [
    botLogChannelRow,
    runAnnouncementChannelRow,
    upcomingRaiderRoleRow,
    botModeratorRoleRow,
    nameSyncRow,
  ];
}

function getSettingsPatch(interaction: SetupComponentInteraction) {
  if (interaction.isChannelSelectMenu()) {
    const selectedChannelId = interaction.values.at(0);

    if (!selectedChannelId) {
      throw new Error("Expected setup channel selection to include a channel id.");
    }

    if (interaction.customId === SetupCustomId.BotLogChannel) {
      return { botLogChannelId: selectedChannelId };
    }

    if (interaction.customId === SetupCustomId.RunAnnouncementChannel) {
      return { runAnnouncementChannelId: selectedChannelId };
    }
  }

  if (interaction.isRoleSelectMenu()) {
    const selectedRoleId = interaction.values.at(0);

    if (!selectedRoleId) {
      throw new Error("Expected setup role selection to include a role id.");
    }

    if (interaction.customId === SetupCustomId.UpcomingRaiderRole) {
      return { upcomingRaiderRoleId: selectedRoleId };
    }

    if (interaction.customId === SetupCustomId.BotModeratorRole) {
      return { botModeratorRoleId: selectedRoleId };
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId === SetupCustomId.NameSyncEnabled) {
      return { syncDiscordNamesToFf14: true };
    }

    if (interaction.customId === SetupCustomId.NameSyncDisabled) {
      return { syncDiscordNamesToFf14: false };
    }
  }

  throw new Error(`Unsupported setup component: ${interaction.customId}`);
}

async function getManageableGuildId(
  interaction: SetupComponentInteraction | Parameters<ChatInputCommand["execute"]>[0],
): Promise<string | undefined> {
  if (!interaction.inGuild() || !interaction.guildId) {
    await interaction.reply({
      content: "Setup can only be run inside a Discord server.",
      flags: MessageFlags.Ephemeral,
    });
    return undefined;
  }

  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: "You need the Manage Server permission to run FullParty setup.",
      flags: MessageFlags.Ephemeral,
    });
    return undefined;
  }

  return interaction.guildId;
}

function formatChannel(channelId: string | undefined): string {
  return channelId ? `<#${channelId}>` : "_Not set_";
}

function formatRole(roleId: string | undefined): string {
  return roleId ? `<@&${roleId}>` : "_Not set_";
}

function formatEnabled(value: boolean): string {
  return value ? "Enabled" : "Disabled";
}
