export type DiscordTimestampStyle = "t" | "T" | "d" | "D" | "f" | "F" | "R";

export function formatDiscordTimestamp(
  value: string | undefined,
  style: DiscordTimestampStyle = "F",
): string | undefined {
  const unixSeconds = parseUnixTimestampSeconds(value);

  return unixSeconds === undefined ? undefined : `<t:${String(unixSeconds)}:${style}>`;
}

export function formatDiscordDateTime(value: string | undefined): string | undefined {
  const absolute = formatDiscordTimestamp(value, "F");
  const relative = formatDiscordTimestamp(value, "R");

  return absolute && relative ? `${absolute} (${relative})` : absolute;
}

function parseUnixTimestampSeconds(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return Math.floor(date.getTime() / 1000);
}
