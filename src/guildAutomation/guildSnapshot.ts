import {
  ChannelType,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type NonThreadGuildBasedChannel,
  type Role,
} from "discord.js";

import type { BotContext } from "../bot/context.js";
import type { GuildSettings } from "../guildSettings/types.js";

export type DiscordGuildSnapshot = {
  available_options: DiscordGuildSnapshotAvailableOptions;
  bot_permissions: string | null;
  channels: DiscordGuildSnapshotChannel[];
  discord_guild_id: string;
  icon_url: string | null;
  member_count: number | null;
  name: string;
  owner_id: string | null;
  roles: DiscordGuildSnapshotRole[];
  settings: DiscordGuildSnapshotSettings;
};

export type DiscordGuildSnapshotAvailableOptions = {
  bot_log_channels: DiscordGuildSnapshotChannelOption[];
  bot_moderator_roles: DiscordGuildSnapshotRoleOption[];
  channels: DiscordGuildSnapshotChannelOption[];
  roles: DiscordGuildSnapshotRoleOption[];
  run_announcement_channels: DiscordGuildSnapshotChannelOption[];
  run_role_template_roles: DiscordGuildSnapshotRoleOption[];
};

export type DiscordGuildSnapshotRoleOption = {
  disabled_reason: string | null;
  id: string;
  label: string;
  managed: boolean;
  position: number;
  usable: boolean;
};

export type DiscordGuildSnapshotChannelOption = {
  disabled_reason: string | null;
  id: string;
  label: string;
  sendable_by_bot: boolean;
  type: number;
  type_name: string;
  usable: boolean;
  viewable_by_bot: boolean;
};

export type DiscordGuildSnapshotRole = {
  can_assign_by_bot: boolean;
  can_delete_by_bot: boolean;
  color: number;
  editable_by_bot: boolean;
  hoist: boolean;
  id: string;
  is_everyone: boolean;
  managed: boolean;
  mentionable: boolean;
  name: string;
  permissions: string;
  position: number;
  usable_as_run_template: boolean;
};

export type DiscordGuildSnapshotChannel = {
  id: string;
  manageable_by_bot: boolean;
  name: string;
  parent_id: string | null;
  position: number | null;
  sendable_by_bot: boolean;
  type: number;
  type_name: string;
  viewable_by_bot: boolean;
};

export type DiscordGuildSnapshotSettings = {
  bot_log_channel_id: string | null;
  bot_moderator_role_id: string | null;
  run_announcement_channel_id: string | null;
  run_role_template_id: string | null;
  sync_discord_names_to_ff14: boolean;
  upcoming_raider_role_id: string | null;
};

export async function createDiscordGuildSnapshot(
  client: Pick<Client, "guilds">,
  context: BotContext,
  discordGuildId: string,
): Promise<DiscordGuildSnapshot> {
  const guild = await client.guilds.fetch(discordGuildId);
  const settings = await context.guildSettings.get(discordGuildId);
  const roles = [...(await guild.roles.fetch()).values()]
    .map((role) => createRoleSnapshot(guild, role))
    .sort(sortRoleSnapshots);
  const channels = [...(await guild.channels.fetch()).values()]
    .flatMap((channel) => (channel ? [channel] : []))
    .map((channel) => createChannelSnapshot(guild, channel))
    .sort(sortChannelSnapshots);

  return {
    available_options: createAvailableOptions(roles, channels),
    bot_permissions: guild.members.me?.permissions.bitfield.toString() ?? null,
    channels,
    discord_guild_id: guild.id,
    icon_url: guild.iconURL({ size: 256 }),
    member_count: guild.memberCount,
    name: guild.name,
    owner_id: guild.ownerId,
    roles,
    settings: serializeGuildSettings(settings),
  };
}

export function serializeGuildSettings(
  settings: GuildSettings,
): DiscordGuildSnapshotSettings {
  return {
    bot_log_channel_id: settings.botLogChannelId ?? null,
    bot_moderator_role_id: settings.botModeratorRoleId ?? null,
    run_announcement_channel_id: settings.runAnnouncementChannelId ?? null,
    run_role_template_id: settings.upcomingRaiderRoleId ?? null,
    sync_discord_names_to_ff14: settings.syncDiscordNamesToFf14,
    upcoming_raider_role_id: settings.upcomingRaiderRoleId ?? null,
  };
}

function createRoleSnapshot(guild: Guild, role: Role): DiscordGuildSnapshotRole {
  const isEveryone = role.id === guild.id;
  const editableByBot = !isEveryone && role.editable;
  const canManage = editableByBot && !role.managed;

  return {
    can_assign_by_bot: canManage,
    can_delete_by_bot: canManage,
    color: role.colors.primaryColor,
    editable_by_bot: editableByBot,
    hoist: role.hoist,
    id: role.id,
    is_everyone: isEveryone,
    managed: role.managed,
    mentionable: role.mentionable,
    name: role.name,
    permissions: role.permissions.bitfield.toString(),
    position: role.position,
    usable_as_run_template: canManage,
  };
}

function createChannelSnapshot(
  guild: Guild,
  channel: NonThreadGuildBasedChannel,
): DiscordGuildSnapshotChannel {
  const permissions = guild.members.me ? channel.permissionsFor(guild.members.me) : null;
  const viewableByBot =
    permissions?.has(PermissionFlagsBits.ViewChannel, true) ?? channel.viewable;
  const sendableByBot =
    channel.isTextBased() &&
    (permissions?.has(PermissionFlagsBits.SendMessages, true) ?? false);
  const manageableByBot =
    permissions?.has(PermissionFlagsBits.ManageChannels, true) ?? false;

  return {
    id: channel.id,
    manageable_by_bot: manageableByBot,
    name: channel.name,
    parent_id: getChannelParentId(channel),
    position: getChannelPosition(channel),
    sendable_by_bot: sendableByBot,
    type: channel.type,
    type_name: formatChannelType(channel.type),
    viewable_by_bot: viewableByBot,
  };
}

function createAvailableOptions(
  roles: DiscordGuildSnapshotRole[],
  channels: DiscordGuildSnapshotChannel[],
): DiscordGuildSnapshotAvailableOptions {
  const textChannels = channels.filter(isSetupChannel);

  return {
    bot_log_channels: textChannels.map((channel) => createChannelOption(channel)),
    bot_moderator_roles: roles
      .filter((role) => !role.is_everyone)
      .map((role) => createRoleOption(role, getBotModeratorRoleDisabledReason(role))),
    channels: channels.map((channel) =>
      createChannelOption(channel, getAnyChannelDisabledReason(channel)),
    ),
    roles: roles
      .filter((role) => !role.is_everyone)
      .map((role) => createRoleOption(role, getAnyRoleDisabledReason(role))),
    run_announcement_channels: textChannels.map((channel) =>
      createChannelOption(channel),
    ),
    run_role_template_roles: roles
      .filter((role) => !role.is_everyone)
      .map((role) => createRoleOption(role, getRunRoleTemplateDisabledReason(role))),
  };
}

function createRoleOption(
  role: DiscordGuildSnapshotRole,
  disabledReason: string | null = null,
): DiscordGuildSnapshotRoleOption {
  return {
    disabled_reason: disabledReason,
    id: role.id,
    label: role.name,
    managed: role.managed,
    position: role.position,
    usable: disabledReason === null,
  };
}

function createChannelOption(
  channel: DiscordGuildSnapshotChannel,
  disabledReason: string | null = getSetupChannelDisabledReason(channel),
): DiscordGuildSnapshotChannelOption {
  return {
    disabled_reason: disabledReason,
    id: channel.id,
    label: channel.name,
    sendable_by_bot: channel.sendable_by_bot,
    type: channel.type,
    type_name: channel.type_name,
    usable: disabledReason === null,
    viewable_by_bot: channel.viewable_by_bot,
  };
}

function getRunRoleTemplateDisabledReason(role: DiscordGuildSnapshotRole): string | null {
  if (role.managed) {
    return "Role is managed by Discord or another integration.";
  }

  if (!role.editable_by_bot) {
    return "Role is at or above the bot role, or the bot cannot manage it.";
  }

  return null;
}

function getBotModeratorRoleDisabledReason(
  role: DiscordGuildSnapshotRole,
): string | null {
  return role.managed ? "Role is managed by Discord or another integration." : null;
}

function getAnyRoleDisabledReason(role: DiscordGuildSnapshotRole): string | null {
  return role.managed ? "Role is managed by Discord or another integration." : null;
}

function getSetupChannelDisabledReason(
  channel: DiscordGuildSnapshotChannel,
): string | null {
  if (!channel.viewable_by_bot) {
    return "Bot cannot view this channel.";
  }

  if (!channel.sendable_by_bot) {
    return "Bot cannot send messages in this channel.";
  }

  return null;
}

function getAnyChannelDisabledReason(
  channel: DiscordGuildSnapshotChannel,
): string | null {
  return channel.viewable_by_bot ? null : "Bot cannot view this channel.";
}

function isSetupChannel(channel: DiscordGuildSnapshotChannel): boolean {
  return setupChannelTypes.has(channel.type);
}

const setupChannelTypes = new Set<number>([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
]);

function sortRoleSnapshots(
  left: DiscordGuildSnapshotRole,
  right: DiscordGuildSnapshotRole,
): number {
  return right.position - left.position || left.name.localeCompare(right.name);
}

function sortChannelSnapshots(
  left: DiscordGuildSnapshotChannel,
  right: DiscordGuildSnapshotChannel,
): number {
  return (
    (left.position ?? Number.MAX_SAFE_INTEGER) -
      (right.position ?? Number.MAX_SAFE_INTEGER) || left.name.localeCompare(right.name)
  );
}

function getChannelParentId(channel: NonThreadGuildBasedChannel): string | null {
  return "parentId" in channel ? channel.parentId : null;
}

function getChannelPosition(channel: NonThreadGuildBasedChannel): number | null {
  return "position" in channel && typeof channel.position === "number"
    ? channel.position
    : null;
}

function formatChannelType(type: ChannelType): string {
  return ChannelType[type];
}
