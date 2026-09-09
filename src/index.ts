import { createLogger } from "./lib/logger.js";
import {
  createRuntimeLogBuffer,
  installConsoleLogCapture,
} from "./lib/runtimeLogBuffer.js";

const runtimeLogs = createRuntimeLogBuffer({ maxLines: 10_000 });
const restoreConsole = installConsoleLogCapture(runtimeLogs);
console.log("[FullParty Bot] Boot file loaded.");

try {
  const { parseConfig } = await import("./config/env.js");
  const config = parseConfig();
  const logger = createLogger(config.LOG_LEVEL);
  runtimeLogs.configureFilePersistence({
    directoryPath: config.RUNTIME_LOG_DIRECTORY,
    retentionDays: config.RUNTIME_LOG_RETENTION_DAYS,
  });
  const { startApplication } = await import("./application/runtime.js");
  const { reportError } = await import("./health/errorReporter.js");
  const startup = startApplication(config, logger, runtimeLogs);
  let shutdownRequested = false;

  async function shutdown(reason: string, exitCode = 0): Promise<void> {
    if (shutdownRequested) return;
    shutdownRequested = true;
    logger.info("Stopping bot.", { reason });
    const timeout = setTimeout(() => {
      logger.error("Shutdown timed out.");
      process.exit(1);
    }, 30_000);
    timeout.unref();
    try {
      const application = await startup;
      await application.stop();
    } catch (error) {
      logger.error("Shutdown failed.", { error });
      exitCode = 1;
    } finally {
      clearTimeout(timeout);
      restoreConsole();
      process.exit(exitCode);
    }
  }

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  const application = await startup;
  process.on("unhandledRejection", (error: unknown) => {
    reportError(application.context, error, {
      source: "runtime",
      action: "unhandled_rejection",
    });
    void shutdown("unhandled_rejection", 1);
  });
  process.on("uncaughtExceptionMonitor", (error) => {
    reportError(application.context, error, {
      source: "runtime",
      action: "uncaught_exception",
    });
  });
} catch (error) {
  createLogger().error("Bot startup failed.", { error });
  restoreConsole();
  process.exitCode = 1;
}
