export function normalizeLimit(limit: number): number {
  return Math.max(1, Math.min(500, Math.floor(limit)));
}

export function createStatusFilter(status: string | string[] | undefined): {
  clause: string;
  parameters: string[];
} {
  if (!status) {
    return {
      clause: "",
      parameters: [],
    };
  }

  if (Array.isArray(status)) {
    return {
      clause: `AND status IN (${status.map(() => "?").join(", ")})`,
      parameters: status,
    };
  }

  return {
    clause: "AND status = ?",
    parameters: [status],
  };
}

export function createTelemetryFilter(filters: {
  affectsHealth?: boolean | undefined;
  discordGuildId?: string | undefined;
  status?: string | string[] | undefined;
}): {
  clause: string;
  parameters: (number | string)[];
} {
  const clauses: string[] = [];
  const parameters: (number | string)[] = [];

  if (filters.discordGuildId) {
    clauses.push("discord_guild_id = ?");
    parameters.push(filters.discordGuildId);
  }

  if (filters.status) {
    if (Array.isArray(filters.status)) {
      clauses.push(`status IN (${filters.status.map(() => "?").join(", ")})`);
      parameters.push(...filters.status);
    } else {
      clauses.push("status = ?");
      parameters.push(filters.status);
    }
  }

  if (filters.affectsHealth !== undefined) {
    clauses.push("affects_health = ?");
    parameters.push(filters.affectsHealth ? 1 : 0);
  }

  return {
    clause: clauses.length > 0 ? `AND ${clauses.join(" AND ")}` : "",
    parameters,
  };
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function startOfUtcHour(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours(),
    ),
  );
}

export function formatBucketLabel(date: Date, intervalMs: number): string {
  return intervalMs >= 86_400_000
    ? date.toISOString().slice(0, 10)
    : `${date.toISOString().slice(0, 13)}:00:00Z`;
}

export function parseJsonField(value: string | null): unknown {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({
      unserializable: String(value),
    });
  }
}
