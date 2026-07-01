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
import type { GuildSettingsPatch } from "../guildSettings/types.js";
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
    const preflightWarning = await createSetupPreflightWarning(interaction, patch);
    const settings = await context.guildSettings.update(guildId, patch);

    await interaction.update(buildSetupPanel(settings, preflightWarning));
  },
};

function buildSetupPanel(
  settings: GuildSettings,
  preflightWarning?: string,
): {
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
      "**Template Role Overrides:**",
      formatTemplateRoleOverrides(settings),
      preflightWarning ? `\n${preflightWarning}` : undefined,
      "",
      "Use the controls below from top to bottom. Changes save immediately.",
    ]
      .filter((line): line is string => line !== undefined)
      .join("\n"),
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

function getSettingsPatch(interaction: SetupComponentInteraction): GuildSettingsPatch {
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

async function createSetupPreflightWarning(
  interaction: SetupComponentInteraction,
  patch: GuildSettingsPatch,
): Promise<string | undefined> {
  if (!interaction.isChannelSelectMenu()) {
    return undefined;
  }

  const channelId = patch.botLogChannelId ?? patch.runAnnouncementChannelId;

  if (!channelId) {
    return undefined;
  }

  const channelLabel = patch.botLogChannelId
    ? "Bot-log channel"
    : "Member-Facing Channel";
  const channel = await resolveSelectedChannel(interaction, channelId);

  if (!channel) {
    return `⚠️ ${channelLabel} preflight: I could not inspect <#${channelId}>. Make sure I can view and send messages there.`;
  }

  const missingPermissions = getMissingChannelSendPermissions(interaction, channel);

  if (missingPermissions.length === 0) {
    return undefined;
  }

  return [
    `⚠️ ${channelLabel} preflight: I cannot fully send messages in <#${channelId}> yet.`,
    `Missing permissions: ${missingPermissions.join(", ")}.`,
  ].join("\n");
}

async function resolveSelectedChannel(
  interaction: SetupComponentInteraction,
  channelId: string,
): Promise<unknown> {
  const resolvedChannel = getCollectionValue(
    getRecordValue(interaction, "channels"),
    channelId,
  );

  if (resolvedChannel) {
    return resolvedChannel;
  }

  const cachedChannel = getCollectionValue(
    getRecordValue(getRecordValue(interaction.guild, "channels"), "cache"),
    channelId,
  );

  if (cachedChannel) {
    return cachedChannel;
  }

  const channels = getRecordValue(interaction.guild, "channels");

  if (isChannelFetcher(channels)) {
    return await Promise.resolve(channels.fetch(channelId));
  }

  return undefined;
}

function getMissingChannelSendPermissions(
  interaction: SetupComponentInteraction,
  channel: unknown,
): string[] {
  const permissions = getBotChannelPermissions(interaction, channel);

  if (!permissions) {
    return ["View Channel", "Send Messages", "Embed Links"];
  }

  return requiredChannelPermissions.flatMap((permission) =>
    permissions.has(permission.bit) ? [] : [permission.label],
  );
}

function getBotChannelPermissions(
  interaction: SetupComponentInteraction,
  channel: unknown,
): PermissionLookup | undefined {
  if (!isPermissionChannel(channel)) {
    return undefined;
  }

  const botMember = interaction.guild?.members.me;
  const permissions = channel.permissionsFor(botMember);

  return isPermissionLookup(permissions) ? permissions : undefined;
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

function formatTemplateRoleOverrides(settings: GuildSettings): string {
  const overrides = settings.runRoleTemplateOverrides ?? [];

  if (overrides.length === 0) {
    return "_None configured_";
  }

  return overrides
    .map(
      (override) =>
        `${formatRole(override.roleId)} - ${override.activityName} (${String(override.activityId)})`,
    )
    .join("\n");
}

function formatEnabled(value: boolean): string {
  return value ? "Enabled" : "Disabled";
}

type PermissionLookup = {
  has(permission: bigint): boolean;
};

type PermissionChannel = {
  permissionsFor(target: unknown): unknown;
};

type CollectionLike = {
  get(id: string): unknown;
};

type ChannelFetcher = {
  fetch(id: string): unknown;
};

const requiredChannelPermissions = [
  {
    bit: PermissionFlagsBits.ViewChannel,
    label: "View Channel",
  },
  {
    bit: PermissionFlagsBits.SendMessages,
    label: "Send Messages",
  },
  {
    bit: PermissionFlagsBits.EmbedLinks,
    label: "Embed Links",
  },
] as const;

function getCollectionValue(collection: unknown, id: string): unknown {
  if (!isCollectionLike(collection)) {
    return undefined;
  }

  return collection.get(id);
}

function getRecordValue(
  value: unknown,
  key: string,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const nestedValue = value[key];

  return isRecord(nestedValue) ? nestedValue : undefined;
}

function isPermissionLookup(value: unknown): value is PermissionLookup {
  return isRecord(value) && typeof value.has === "function";
}

function isPermissionChannel(value: unknown): value is PermissionChannel {
  return isRecord(value) && typeof value.permissionsFor === "function";
}

function isCollectionLike(value: unknown): value is CollectionLike {
  return isRecord(value) && typeof value.get === "function";
}

function isChannelFetcher(value: unknown): value is ChannelFetcher {
  return isRecord(value) && typeof value.fetch === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
