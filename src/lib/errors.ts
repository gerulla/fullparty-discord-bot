import { isRecord } from "./valueReaders.js";

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function getDiscordApiErrorCode(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const code = error.code;

  if (typeof code === "number" || typeof code === "string") {
    return String(code);
  }

  const rawError = error.rawError;

  if (!isRecord(rawError)) {
    return undefined;
  }

  const rawCode = rawError.code;

  return typeof rawCode === "number" || typeof rawCode === "string"
    ? String(rawCode)
    : undefined;
}
