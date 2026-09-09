import type { Client } from "discord.js";
import { isRecord } from "../lib/valueReaders.js";
import type {
  GuildRunReminderGuild,
  GuildRunReminderMember,
  GuildRunRole,
} from "./types.js";

export async function fetchGuildRole(
  guild: GuildRunReminderGuild,
  roleId: string,
): Promise<GuildRunRole | undefined> {
  const cachedRole = guild.roles?.cache?.get(roleId);

  if (isGuildRunRole(cachedRole)) {
    return cachedRole;
  }

  const fetchedRole = await guild.roles?.fetch?.(roleId);

  return isGuildRunRole(fetchedRole) ? fetchedRole : undefined;
}

export function isGuildRunRole(value: unknown): value is GuildRunRole {
  return (
    isRecord(value) && typeof value.id === "string" && typeof value.name === "string"
  );
}

export function createUnknownRole(roleId: string): GuildRunRole {
  return {
    id: roleId,
    name: roleId,
  };
}

export async function fetchGuildRunReminderGuild(
  client: Client,
  guildId: string,
): Promise<GuildRunReminderGuild> {
  const guild = await client.guilds.fetch(guildId);

  if (!isGuildRunReminderGuild(guild)) {
    throw new Error(`Discord guild ${guildId} cannot be used for run reminder sync.`);
  }

  return guild;
}

function isGuildRunReminderGuild(value: unknown): value is GuildRunReminderGuild {
  return (
    isRecord(value) &&
    isRecord(value.members) &&
    typeof value.members.fetch === "function"
  );
}

export function isRoleAssignableMember(
  value: GuildRunReminderMember,
): value is GuildRunReminderMember & {
  roles: { add(roleId: string, reason?: string): Promise<unknown> };
} {
  return isRecord(value.roles) && typeof value.roles.add === "function";
}

export function isNicknameSyncableMember(
  value: GuildRunReminderMember,
): value is GuildRunReminderMember & {
  setNickname(nickname: string, reason?: string): Promise<unknown>;
} {
  return typeof value.setNickname === "function";
}

export function getCurrentNickname(member: GuildRunReminderMember): string | undefined {
  return member.nickname ?? member.displayName;
}
