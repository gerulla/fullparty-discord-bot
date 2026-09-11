import { truncateText } from "./presentation/common.js";
import type { GuildRunReminderData } from "./runReminderTypes.js";

export function createRunRoleName(data: GuildRunReminderData): string {
  const activityTypeName =
    [data.run?.activity_type?.name?.en, data.activity_type?.name?.en]
      .map((name) => name?.trim())
      .find((name) => Boolean(name)) ?? `#${String(data.run_id)}`;
  const time = formatRunRoleStartTime(data.starts_at ?? data.run?.starts_at);
  const prefix = "Run: ";
  const suffix = time ? ` ${time}` : "";

  // Preserve the start time when trimming a long activity type to Discord's limit.
  return `${prefix}${truncateText(activityTypeName, 100 - prefix.length - suffix.length)}${suffix}`;
}

function formatRunRoleStartTime(startsAt: string | null | undefined): string | undefined {
  if (!startsAt) return undefined;
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return undefined;

  return `${date.getUTCHours().toString().padStart(2, "0")}:${date
    .getUTCMinutes()
    .toString()
    .padStart(2, "0")} UTC`;
}
