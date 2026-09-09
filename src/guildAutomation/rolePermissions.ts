import { PermissionFlagsBits, PermissionsBitField } from "discord.js";
import { getErrorMessage } from "../lib/errors.js";
import { isRecord } from "../lib/valueReaders.js";
import { isGuildRunRole } from "./discordGateway.js";
import type {
  GuildPermissionOverwrite,
  GuildPermissionOverwriteChannel,
  GuildRoleCreateOptions,
  GuildRunReminderGuild,
  GuildRunRole,
  PermissionOverwriteValue,
  RunReminderFailure,
} from "./types.js";

export function getRunRolePreflightFailure(
  guild: GuildRunReminderGuild,
  templateRole: GuildRunRole,
): string | undefined {
  const botMember = guild.members.me;

  if (
    botMember?.permissions &&
    !botMember.permissions.has(PermissionFlagsBits.ManageRoles)
  ) {
    return "bot_missing_manage_roles";
  }

  const botHighestRole = botMember?.roles?.highest;

  if (
    botHighestRole?.comparePositionTo &&
    botHighestRole.comparePositionTo(templateRole) <= 0
  ) {
    return "template_role_not_below_bot";
  }

  return undefined;
}

export async function createRunRoleFromTemplate(
  guild: GuildRunReminderGuild,
  templateRole: GuildRunRole,
  roleName: string,
  runId: number,
): Promise<GuildRunRole> {
  if (!guild.roles?.create) {
    throw new Error("Discord guild roles cannot be managed by this bot.");
  }

  const createOptions: GuildRoleCreateOptions = {
    name: roleName,
    permissions: formatPermissionValue(templateRole.permissions),
    reason: `FullParty temporary run role for run ${String(runId)}.`,
  };

  if (typeof templateRole.color === "number") {
    createOptions.color = templateRole.color;
  }

  if (typeof templateRole.hoist === "boolean") {
    createOptions.hoist = templateRole.hoist;
  }

  if (typeof templateRole.mentionable === "boolean") {
    createOptions.mentionable = templateRole.mentionable;
  }

  const role = await guild.roles.create(createOptions);

  if (!isGuildRunRole(role)) {
    throw new Error("Discord did not return a manageable run role.");
  }

  return role;
}

export async function copyTemplatePermissionOverwrites(
  guild: GuildRunReminderGuild,
  templateRoleId: string,
  runRoleId: string,
  runId: number,
  failures: RunReminderFailure[],
): Promise<number> {
  const channels = await fetchGuildChannels(guild);
  let copiedOverwriteCount = 0;

  for (const channel of channels) {
    if (!isPermissionOverwriteChannel(channel)) {
      continue;
    }

    const templateOverwrite = getTemplatePermissionOverwrite(channel, templateRoleId);

    if (!templateOverwrite) {
      continue;
    }

    if (!channel.permissionOverwrites?.edit) {
      failures.push({
        discordUserId: "*",
        error: `Channel ${channel.name ?? channel.id} permissions cannot be edited.`,
      });
      continue;
    }

    try {
      await channel.permissionOverwrites.edit(
        runRoleId,
        createPermissionOverwriteOptions(templateOverwrite),
        `FullParty copied template role overwrites for run ${String(runId)}.`,
      );
      copiedOverwriteCount += 1;
    } catch (error) {
      failures.push({
        discordUserId: "*",
        error: `Unable to copy permissions for ${channel.name ?? channel.id}: ${getErrorMessage(error)}`,
      });
    }
  }

  return copiedOverwriteCount;
}

async function fetchGuildChannels(guild: GuildRunReminderGuild): Promise<unknown[]> {
  const channels = await guild.channels?.fetch();

  if (!channels) {
    return [];
  }

  if (Array.isArray(channels)) {
    return [...(channels as unknown[])];
  }

  if (channels instanceof Map) {
    return [...(channels as Map<unknown, unknown>).values()];
  }

  if (hasValuesFunction(channels)) {
    return [...channels.values()];
  }

  return [];
}

function hasValuesFunction(value: unknown): value is { values(): Iterable<unknown> } {
  return isRecord(value) && typeof value.values === "function";
}

function getTemplatePermissionOverwrite(
  channel: GuildPermissionOverwriteChannel,
  templateRoleId: string,
): GuildPermissionOverwrite | undefined {
  const overwrite = channel.permissionOverwrites?.cache?.get(templateRoleId);

  if (!isGuildPermissionOverwrite(overwrite)) {
    return undefined;
  }

  return overwrite;
}

function formatPermissionValue(value: PermissionOverwriteValue | undefined): string {
  const bitfield = value?.bitfield;

  if (typeof bitfield === "bigint" || typeof bitfield === "number") {
    return bitfield.toString();
  }

  if (typeof bitfield === "string") {
    return bitfield;
  }

  if (typeof value?.toString === "function") {
    return value.toString();
  }

  return "0";
}

function createPermissionOverwriteOptions(
  overwrite: GuildPermissionOverwrite,
): Record<string, boolean> {
  const options: Record<string, boolean> = {};

  for (const permission of getPermissionNames(overwrite.allow)) {
    options[permission] = true;
  }

  for (const permission of getPermissionNames(overwrite.deny)) {
    options[permission] = false;
  }

  return options;
}

function getPermissionNames(
  value: PermissionOverwriteValue | undefined,
): ReturnType<PermissionsBitField["toArray"]> {
  const bitfield = getPermissionBitfield(value);

  if (bitfield === 0n) {
    return [];
  }

  return new PermissionsBitField(bitfield).toArray();
}

function getPermissionBitfield(value: PermissionOverwriteValue | undefined): bigint {
  const bitfield = value?.bitfield;

  if (typeof bitfield === "bigint") {
    return bitfield;
  }

  if (typeof bitfield === "number") {
    return BigInt(bitfield);
  }

  if (typeof bitfield === "string" && /^\d+$/u.test(bitfield)) {
    return BigInt(bitfield);
  }

  if (typeof value?.toString === "function") {
    const stringValue = value.toString();

    if (/^\d+$/u.test(stringValue)) {
      return BigInt(stringValue);
    }
  }

  return 0n;
}

function isGuildPermissionOverwrite(value: unknown): value is GuildPermissionOverwrite {
  return isRecord(value) && typeof value.id === "string";
}

function isPermissionOverwriteChannel(
  value: unknown,
): value is GuildPermissionOverwriteChannel {
  return isRecord(value) && typeof value.id === "string";
}
