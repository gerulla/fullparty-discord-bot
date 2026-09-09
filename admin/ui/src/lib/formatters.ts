import type {
  AdminFailureRecord as FailureRecord,
  AdminGuildRecord as GuildRecord,
} from "../../../src/shared/contracts.js";

export function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

export function formatNullableNumber(value: number | null | undefined): string {
  return typeof value === "number" ? formatNumber(value) : "Unknown";
}

export function formatDateLabel(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);

  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        day: "2-digit",
        month: "short",
      }).format(date);
}

export function formatHourLabel(value: string): string {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        hour12: false,
      }).format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "medium",
      }).format(date);
}

export function formatLogTime(value: string): string {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        month: "short",
        second: "2-digit",
      }).format(date);
}

export function formatDetails(value: unknown): string {
  if (value === null || value === undefined) {
    return "No extra details captured.";
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

export function formatFailureTitle(failure: FailureRecord): string {
  return `${humanizeKey(failure.source)} / ${humanizeKey(failure.action)}`;
}

export function formatGuildName(guild: GuildRecord | null | undefined): string {
  return guild?.name ?? guild?.discordGuildId ?? "Selected guild";
}

export function formatSettingValue(value: string | null | undefined): string {
  return value && value.length > 0 ? value : "Missing";
}

export function formatBoolean(value: boolean | null | undefined): string {
  return value ? "On" : "Off";
}

export function formatCheckName(value: string): string {
  return humanizeKey(value);
}

export function humanizeKey(value: string): string {
  return value
    .split(/[_.-]/u)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

export function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}
