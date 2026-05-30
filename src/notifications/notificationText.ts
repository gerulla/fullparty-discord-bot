export function resolveFullpartyActionUrl(
  actionUrl: string,
  fullpartyWebBaseUrl: string,
): string {
  try {
    return new URL(actionUrl).toString();
  } catch {
    return new URL(actionUrl, ensureTrailingSlash(fullpartyWebBaseUrl)).toString();
  }
}

export function truncateForDiscord(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength <= 3) {
    return ".".repeat(maxLength);
  }

  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

export function humanizeIdentifier(value: string): string {
  return value
    .split(/[._-]+/u)
    .filter(Boolean)
    .map((part) => `${part.at(0)?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
