import { getDiscordApiErrorCode, getErrorMessage } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import {
  recordFailureSafely,
  serializeFailureError,
  type BotFailureInput,
  type FailureReporter,
} from "./failureReporter.js";

type ReportingContext = { logger: Logger; failureReporter?: FailureReporter | undefined };
type FailureContext = Pick<
  BotFailureInput,
  "action" | "source" | "discordGuildId" | "discordUserId" | "eventType" | "runId"
>;

const expectedDiscordCodes = new Set([
  "10007",
  "10011",
  "10013",
  "50001",
  "50007",
  "50013",
]);

export function isExpectedDiscordFailure(error: unknown): boolean {
  const code = getDiscordApiErrorCode(error);
  return code !== undefined && expectedDiscordCodes.has(code);
}

export function reportError(
  context: ReportingContext,
  error: unknown,
  input: FailureContext,
): void {
  const expected = isExpectedDiscordFailure(error);
  context.logger[expected ? "warn" : "error"](`${input.action} failed.`, {
    ...input,
    error: serializeFailureError(error),
  });
  recordFailureSafely(context.failureReporter, context.logger, {
    ...input,
    affectsHealth: !expected,
    details: { error: serializeFailureError(error) },
    errorCode:
      getDiscordApiErrorCode(error) ??
      (error instanceof Error ? error.name : "unknown_error"),
    message: getErrorMessage(error),
    severity: expected ? "warn" : "error",
  });
}

export async function runReportedTask(
  context: ReportingContext,
  input: FailureContext,
  operation: () => unknown,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    reportError(context, error, input);
  }
}
