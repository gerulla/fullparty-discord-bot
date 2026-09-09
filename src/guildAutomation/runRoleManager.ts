import type { GuildSettings } from "../guildSettings/types.js";
import { createUnknownRole, fetchGuildRole } from "./discordGateway.js";
import { truncateText } from "./presentation/common.js";
import {
  copyTemplatePermissionOverwrites,
  createRunRoleFromTemplate,
  getRunRolePreflightFailure,
} from "./rolePermissions.js";
import type { GuildRunReminderData } from "./runReminderTypes.js";
import type {
  GuildAutomationProcessorOptions,
  GuildRunReminderGuild,
  GuildRunRole,
  RunReminderFailure,
} from "./types.js";

type EnsureRunRoleResult = {
  copiedOverwriteCount: number;
  created: boolean;
  failures: RunReminderFailure[];
  role?: GuildRunRole;
  roleName: string;
  skippedReason?: string;
  templateRole: GuildRunRole;
};

type RunRoleTemplateSelection = {
  overrideActivityId?: number | undefined;
  overrideActivityName?: string | undefined;
  roleId?: string | undefined;
  source: "default" | "none" | "override";
};

export function selectRunRoleTemplate(
  settings: GuildSettings,
  data: GuildRunReminderData,
): RunRoleTemplateSelection {
  const override = data.activity_id
    ? settings.runRoleTemplateOverrides?.find(
        (candidate) => candidate.activityId === data.activity_id,
      )
    : undefined;

  if (override) {
    return {
      overrideActivityId: override.activityId,
      overrideActivityName: override.activityName,
      roleId: override.roleId,
      source: "override",
    };
  }

  if (settings.upcomingRaiderRoleId) {
    return {
      ...(data.activity_id ? { overrideActivityId: data.activity_id } : {}),
      roleId: settings.upcomingRaiderRoleId,
      source: "default",
    };
  }

  return {
    ...(data.activity_id ? { overrideActivityId: data.activity_id } : {}),
    source: "none",
  };
}

export async function ensureRunRole(
  options: GuildAutomationProcessorOptions,
  guild: GuildRunReminderGuild,
  data: GuildRunReminderData,
  settings: GuildSettings,
): Promise<EnsureRunRoleResult> {
  const failures: RunReminderFailure[] = [];
  const templateSelection = selectRunRoleTemplate(settings, data);
  const templateRoleId = templateSelection.roleId;

  if (!templateRoleId) {
    return {
      copiedOverwriteCount: 0,
      created: false,
      failures,
      roleName: "",
      skippedReason: "upcoming_raider_role_not_configured",
      templateRole: createUnknownRole(templateRoleId ?? "unknown"),
    };
  }

  const templateRole = await fetchGuildRole(guild, templateRoleId);

  if (!templateRole) {
    return {
      copiedOverwriteCount: 0,
      created: false,
      failures,
      roleName: "",
      skippedReason: "template_role_not_found",
      templateRole: createUnknownRole(templateRoleId),
    };
  }

  const preflightFailure = getRunRolePreflightFailure(guild, templateRole);

  if (preflightFailure) {
    return {
      copiedOverwriteCount: 0,
      created: false,
      failures,
      roleName: "",
      skippedReason: preflightFailure,
      templateRole,
    };
  }

  const existingMapping = await options.context.guildRunRoles?.get(
    data.discord_guild_id,
    data.run_id,
  );

  if (existingMapping?.status === "active") {
    const mappedRole = await fetchGuildRole(guild, existingMapping.roleId);

    if (mappedRole) {
      const copiedOverwriteCount = await copyTemplatePermissionOverwrites(
        guild,
        templateRole.id,
        mappedRole.id,
        data.run_id,
        failures,
      );

      return {
        copiedOverwriteCount,
        created: false,
        failures,
        role: mappedRole,
        roleName: mappedRole.name,
        templateRole,
      };
    }
  }

  const roleName = createRunRoleName(data);
  const role = await createRunRoleFromTemplate(
    guild,
    templateRole,
    roleName,
    data.run_id,
  );
  const copiedOverwriteCount = await copyTemplatePermissionOverwrites(
    guild,
    templateRole.id,
    role.id,
    data.run_id,
    failures,
  );
  const now = new Date().toISOString();

  await options.context.guildRunRoles?.upsert({
    createdAt: existingMapping?.createdAt ?? now,
    discordGuildId: data.discord_guild_id,
    roleId: role.id,
    roleName: role.name,
    runId: data.run_id,
    status: "active",
    templateRoleId: templateRole.id,
    updatedAt: now,
  });

  return {
    copiedOverwriteCount,
    created: true,
    failures,
    role,
    roleName: role.name,
    templateRole,
  };
}

function createRunRoleName(data: GuildRunReminderData): string {
  const activityName =
    data.activity_title ?? data.activity ?? `Run #${String(data.run_id)}`;
  const time = formatRunRoleStartTime(data.starts_at);
  const roleName = `FullParty: ${activityName}${time ? ` ${time}` : ""}`;

  return truncateText(roleName, 100);
}

function formatRunRoleStartTime(startsAt: string | undefined): string | undefined {
  if (!startsAt) {
    return undefined;
  }

  const date = new Date(startsAt);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return `${date.getUTCHours().toString().padStart(2, "0")}:${date
    .getUTCMinutes()
    .toString()
    .padStart(2, "0")} UTC`;
}
