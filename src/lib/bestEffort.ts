import type { Logger } from "./logger.js";

export function bestEffort(
  logger: Logger,
  message: string,
  operation: () => unknown,
): void {
  try {
    void Promise.resolve(operation()).catch((error: unknown) => {
      logger.warn(message, { error });
    });
  } catch (error) {
    logger.warn(message, { error });
  }
}
