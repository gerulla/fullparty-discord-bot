import type { Client, MessageCreateOptions } from "discord.js";
import type { BotContext } from "../bot/context.js";

export type GuildAutomationProcessorOptions = {
  client: Client;
  context: Pick<
    BotContext,
    "guildSettings" | "guildRunRoles" | "adminStore" | "failureReporter" | "logger"
  >;
};

export type RoleAssignmentProcessorOptions = {
  dryRun?: boolean | undefined;
};

export type GuildRunReminderGuild = {
  channels?: {
    fetch(): Promise<unknown>;
  };
  members: {
    fetch(discordUserId: string): Promise<GuildRunReminderMember>;
    me?: GuildRunReminderMember | null;
  };
  roles?: {
    cache?: {
      get(roleId: string): unknown;
    };
    create?(options: GuildRoleCreateOptions): Promise<GuildRunRole>;
    fetch?(roleId: string): Promise<unknown>;
  };
};

export type GuildRunReminderMember = {
  displayName?: string;
  nickname?: string | null;
  permissions?: {
    has(permission: bigint): boolean;
  };
  roles?: {
    add?(roleId: string, reason?: string): Promise<unknown>;
    highest?: GuildRunRole;
  };
  setNickname?(nickname: string, reason?: string): Promise<unknown>;
};

export type GuildRunRole = {
  color?: number;
  comparePositionTo?(role: GuildRunRole): number;
  delete?(reason?: string): Promise<unknown>;
  hoist?: boolean;
  id: string;
  mentionable?: boolean;
  name: string;
  permissions?: {
    bitfield?: bigint | number | string;
    toString?(): string;
  };
  position?: number;
};

export type GuildRoleCreateOptions = {
  color?: number;
  hoist?: boolean;
  mentionable?: boolean;
  name: string;
  permissions?: string;
  reason?: string;
};

export type GuildPermissionOverwrite = {
  allow?: PermissionOverwriteValue;
  deny?: PermissionOverwriteValue;
  id: string;
  type?: number | string;
};

export type GuildPermissionOverwriteChannel = {
  id: string;
  name?: string;
  permissionOverwrites?: {
    cache?: {
      get(id: string): unknown;
    };
    edit?(
      roleId: string,
      options: Record<string, boolean>,
      reason?: string,
    ): Promise<unknown>;
  };
};

export type PermissionOverwriteValue = {
  bitfield?: bigint | number | string;
  toString?(): string;
};

export type SendableChannel = {
  send(message: MessageCreateOptions): Promise<unknown>;
};

export type GuildMessageTelemetryMetadata = {
  discordGuildId?: string | undefined;
  messageType?: string | undefined;
};

export type RunReminderFailure = {
  discordUserId: string;
  error: string;
};
