import {
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

import type { BotContext } from "../bot/context.js";
import { guildSettingsUrl } from "../discord/linkMessages.js";
import { buildSetupPanel, type SetupPage } from "../discord/setupMessages.js";
import { getScheduleMode } from "../guildSchedule/settings.js";
import {
  createDefaultGuildSettings,
  type GuildSettings,
  type GuildSettingsPatch,
} from "../guildSettings/types.js";
import type { ChatInputCommand, SetupComponentInteraction } from "./types.js";
import { handleScheduleSetup } from "./scheduleSetup.js";
import { handleScheduleFormatSetup } from "./scheduleFormatSetup.js";
import { ScheduleCustomId, SetupCustomId } from "./setupIds.js";
import { CommandError } from "./commandError.js";

const setupCustomIdPrefix = "setup";

export const setupCommand: ChatInputCommand = {
  componentCustomIdPrefix: setupCustomIdPrefix,
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configure FullParty guild integration settings.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild),
  async execute(interaction) {
    const guildId = await getManageableGuildId(interaction);

    if (!guildId) {
      return;
    }

    await interaction.reply(buildSetupPanel(createDefaultGuildSettings(guildId)));
  },
  async handleComponent(interaction, context) {
    const guildId = await getManageableGuildId(interaction);

    if (!guildId) {
      return;
    }

    await interaction.deferUpdate();

    if (interaction.customId.startsWith(ScheduleCustomId.FormatPrefix)) {
      await handleScheduleFormatSetup(interaction, context, guildId);
      return;
    }

    if (interaction.isButton() && interaction.customId === SetupCustomId.Home) {
      await interaction.editReply({
        ...buildSetupPanel(createDefaultGuildSettings(guildId)),
        content: null,
        embeds: [],
      });
      return;
    }
    if (
      interaction.customId.startsWith("setup:schedule:") ||
      interaction.customId === SetupCustomId.ScheduleChannel ||
      interaction.customId === SetupCustomId.LegacyRunAnnouncementChannel
    ) {
      await handleScheduleSetup(interaction, context, guildId, (patch, settings) =>
        createSetupPreflightWarning(interaction, patch, settings),
      );
      return;
    }

    const page = getSetupPage(interaction);
    if (page) {
      const settings = await context.guildSettings.get(guildId);
      await interaction.editReply({
        ...buildSetupPanel(settings, page, panelOptions(context, settings, page)),
        content: null,
        embeds: [],
      });
      return;
    }

    const patch = getSettingsPatch(interaction);
    const preflightWarning = await createSetupPreflightWarning(interaction, patch);
    const settings = await context.guildSettings.update(guildId, patch);
    const updatedPage = getPageForPatch(patch);

    await interaction.editReply({
      ...buildSetupPanel(
        settings,
        updatedPage,
        panelOptions(context, settings, updatedPage, preflightWarning),
      ),
      content: null,
      embeds: [],
    });
  },
};

function panelOptions(
  context: BotContext,
  settings: GuildSettings,
  page: SetupPage,
  warning?: string,
) {
  return {
    warning,
    scheduleState:
      page === "schedule" ? context.guildScheduleStore?.get(settings.guildId) : undefined,
    botSettingsUrl:
      page === "roles"
        ? guildSettingsUrl({
            groupSlug: settings.groupSlug,
            fullpartyWebBaseUrl: context.fullpartyWebBaseUrl,
          })
        : undefined,
  };
}

function getSetupPage(interaction: SetupComponentInteraction): SetupPage | undefined {
  if (!interaction.isButton()) return undefined;
  switch (interaction.customId) {
    case SetupCustomId.BotSettings:
      return "bot";
    case SetupCustomId.RoleTemplates:
      return "roles";
    case SetupCustomId.NicknameSync:
      return "nickname";
    default:
      return undefined;
  }
}

function getPageForPatch(patch: GuildSettingsPatch): SetupPage {
  if (patch.runAnnouncementChannelId !== undefined) return "schedule";
  if (patch.upcomingRaiderRoleId !== undefined) return "roles";
  if (patch.syncDiscordNamesToFf14 !== undefined) return "nickname";
  return "bot";
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

  throw new CommandError(
    "That setup control is no longer available. Run /setup again.",
    "setup_control_invalid",
  );
}

async function createSetupPreflightWarning(
  interaction: SetupComponentInteraction,
  patch: GuildSettingsPatch,
  settings?: GuildSettings,
): Promise<string | undefined> {
  const enablingSchedule = patch.scheduleMode && patch.scheduleMode !== "disabled";
  if (!interaction.isChannelSelectMenu() && !enablingSchedule) return undefined;

  const channelId =
    patch.botLogChannelId ??
    patch.runAnnouncementChannelId ??
    (enablingSchedule ? settings?.runAnnouncementChannelId : undefined);

  if (!channelId) {
    return undefined;
  }

  const channelLabel = patch.botLogChannelId ? "Bot-log channel" : "Schedule Channel";
  const channel = await resolveSelectedChannel(interaction, channelId);

  if (!channel) {
    return `⚠️ ${channelLabel} preflight: I could not inspect <#${channelId}>. Make sure I can view and send messages there.`;
  }

  const missingPermissions = getMissingChannelSendPermissions(interaction, channel);
  const mode = patch.scheduleMode ?? (settings ? getScheduleMode(settings) : "disabled");
  if (
    !patch.botLogChannelId &&
    mode !== "disabled" &&
    !getBotChannelPermissions(interaction, channel)?.has(
      PermissionFlagsBits.ReadMessageHistory,
    )
  ) {
    missingPermissions.push("Read Message History");
  }

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
