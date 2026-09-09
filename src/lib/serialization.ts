const sensitiveKey = /token|secret|authorization|password/iu;

export function serializeLogValue(
  value: unknown,
  seen = new WeakSet(),
  depth = 0,
): unknown {
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object" || value === null) return value;
  if (depth > 8) return "[Truncated]";
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  try {
    if (value instanceof Error) {
      const details = value as Error & {
        code?: unknown;
        status?: unknown;
        rawError?: unknown;
      };
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
        code: serializeLogValue(details.code, seen, depth + 1),
        status: serializeLogValue(details.status, seen, depth + 1),
        cause: serializeLogValue(value.cause, seen, depth + 1),
        rawError: serializeLogValue(details.rawError, seen, depth + 1),
      };
    }
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value))
      return value.map((entry) => serializeLogValue(entry, seen, depth + 1));
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        sensitiveKey.test(key) ? "[Redacted]" : serializeLogValue(entry, seen, depth + 1),
      ]),
    );
  } finally {
    seen.delete(value);
  }
}
