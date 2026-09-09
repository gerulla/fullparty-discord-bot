import type { Client } from "discord.js";
import type { BotContext } from "../bot/context.js";
import type { HealthStatus } from "./failureReporter.js";

type HealthCheckResult = {
  ok: boolean;
  status: HealthStatus | "not_configured";
  [key: string]: unknown;
};

type HealthServiceDependencies = {
  client: Client;
  context: Pick<
    BotContext,
    "failureReporter" | "guildRunReminderQueue" | "guildMemberCacheScheduler"
  >;
};

export async function createHealthResponse(options: HealthServiceDependencies): Promise<{
  checks: Record<string, HealthCheckResult>;
  ok: boolean;
  status: HealthStatus;
  timestamp: string;
  uptime_seconds: number;
}> {
  const checks: Record<string, HealthCheckResult> = {
    discord: createDiscordHealthCheck(options.client),
  };

  checks.recent_failures = options.context.failureReporter
    ? await options.context.failureReporter.getHealthSummary()
    : {
        configured: false,
        ok: true,
        status: "not_configured",
      };

  checks.guild_automation_queue = options.context.guildRunReminderQueue?.getHealthSummary
    ? await options.context.guildRunReminderQueue.getHealthSummary()
    : {
        configured: false,
        ok: true,
        status: "not_configured",
      };

  checks.guild_member_cache = options.context.guildMemberCacheScheduler
    ? await options.context.guildMemberCacheScheduler.getHealthSummary()
    : {
        configured: false,
        ok: true,
        status: "not_configured",
      };

  const status = aggregateHealthStatus(Object.values(checks));

  return {
    checks,
    ok: status !== "unhealthy",
    status,
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
  };
}

function createDiscordHealthCheck(client: Client): HealthCheckResult {
  const ready = typeof client.isReady === "function" ? client.isReady() : false;
  const pingMs = "ws" in client ? client.ws.ping : undefined;
  const userId = client.user?.id;

  return {
    ok: ready,
    ping_ms: typeof pingMs === "number" ? pingMs : null,
    ready,
    status: ready ? "healthy" : "unhealthy",
    user_id: userId ?? null,
  };
}

function aggregateHealthStatus(checks: HealthCheckResult[]): HealthStatus {
  if (checks.some((check) => check.status === "unhealthy")) {
    return "unhealthy";
  }

  if (checks.some((check) => check.status === "degraded")) {
    return "degraded";
  }

  return "healthy";
}
