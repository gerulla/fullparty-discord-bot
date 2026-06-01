import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { Client } from "discord.js";

import type { BotContext } from "../bot/context.js";

export type AdminApiOptions = {
  adminApiToken?: string | undefined;
  client: Client;
  context: BotContext;
  createHealth: () => Promise<Record<string, unknown>>;
};

export async function handleAdminApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: AdminApiOptions,
): Promise<boolean> {
  if (url.pathname !== "/admin/api" && !url.pathname.startsWith("/admin/api/")) {
    return false;
  }

  if (request.method !== "GET") {
    sendJson(response, 405, {
      error: "method_not_allowed",
      message: "Admin API only supports GET requests right now.",
    });
    return true;
  }

  if (!options.context.adminStore || !options.adminApiToken) {
    sendJson(response, 503, {
      error: "admin_api_disabled",
      message: "Admin API is not configured.",
    });
    return true;
  }

  if (!isAuthorized(request, options.adminApiToken)) {
    sendJson(response, 401, {
      error: "unauthorized",
      message: "Admin API token is required.",
    });
    return true;
  }

  await syncLiveGuildRuntime(options);

  const limit = getLimit(url);
  const store = options.context.adminStore;

  if (url.pathname === "/admin/api/summary") {
    const [health, telemetry, guildAutomationQueue] = await Promise.all([
      options.createHealth(),
      store.getSummary(),
      store.getQueueSummary(),
    ]);

    sendJson(response, 200, {
      health,
      queue: {
        guildAutomation: guildAutomationQueue,
        userDms: createUserDmQueueSummary(options.context),
      },
      telemetry,
    });
    return true;
  }

  if (url.pathname === "/admin/api/events") {
    sendJson(response, 200, {
      data: await store.getEvents(limit),
    });
    return true;
  }

  if (url.pathname === "/admin/api/dms") {
    sendJson(response, 200, {
      data: await store.getDmDeliveries(limit),
      queues: options.context.userDmRateLimiter?.getQueueSnapshot() ?? [],
    });
    return true;
  }

  if (url.pathname === "/admin/api/commands") {
    sendJson(response, 200, {
      data: await store.getCommandUsages(limit),
    });
    return true;
  }

  if (url.pathname === "/admin/api/guild-messages") {
    sendJson(response, 200, {
      data: await store.getGuildMessages(limit),
    });
    return true;
  }

  if (url.pathname === "/admin/api/guilds") {
    sendJson(response, 200, {
      data: await store.getGuilds(),
    });
    return true;
  }

  if (url.pathname === "/admin/api/automation") {
    sendJson(response, 200, {
      data: await store.getAutomationRuns(limit),
    });
    return true;
  }

  if (url.pathname === "/admin/api/failures") {
    sendJson(response, 200, {
      data: await store.getFailures(limit),
    });
    return true;
  }

  if (url.pathname === "/admin/api/logs") {
    const logLimit = getLogLimit(url);

    sendJson(response, 200, {
      data: options.context.runtimeLogs?.getEntries(logLimit) ?? [],
      meta: {
        ...options.context.runtimeLogs?.getPersistenceInfo(),
        limit: logLimit,
        maxLines: options.context.runtimeLogs?.getMaxLines() ?? 10_000,
        totalBuffered: options.context.runtimeLogs?.getTotalBuffered() ?? 0,
      },
    });
    return true;
  }

  if (url.pathname === "/admin/api/metrics") {
    const [health, metrics, guildDashboards, guildAutomationQueue, recentFailures] =
      await Promise.all([
        options.createHealth(),
        store.getDashboardMetrics(),
        store.getGuildDashboards(),
        store.getQueueSummary(),
        store.getFailures(50),
      ]);
    const guilds = guildDashboards.map((guildDashboard) => guildDashboard.guild);

    sendJson(response, 200, {
      data: {
        diagnostics: {
          healthIssues: createHealthIssues(health),
          recentFailures,
        },
        guilds: {
          details: guildDashboards,
          linked: guilds.filter((guild) => guild.linked).length,
          records: guilds,
          total: guilds.length,
          unavailable: guilds.filter((guild) => guild.unavailable).length,
        },
        health,
        metrics,
        queue: {
          guildAutomation: guildAutomationQueue,
          userDms: createUserDmQueueSummary(options.context),
        },
      },
    });
    return true;
  }

  if (url.pathname === "/admin/api/queues") {
    const guildAutomationQueue = await store.getQueueSummary();

    sendJson(response, 200, {
      data: {
        guildAutomation: guildAutomationQueue,
        userDms: createUserDmQueueSummary(options.context),
      },
    });
    return true;
  }

  sendJson(response, 404, {
    error: "not_found",
    message: "Admin API route not found.",
  });
  return true;
}

type AdminHealthIssue = {
  check: string;
  details: Record<string, unknown>;
  occurredAt: string | null;
  reason: string;
  severity: "info" | "warn" | "error";
  status: string;
};

function createHealthIssues(health: Record<string, unknown>): AdminHealthIssue[] {
  const checks = isRecord(health.checks) ? health.checks : {};

  return Object.entries(checks).flatMap(([checkName, checkValue]) => {
    if (!isRecord(checkValue)) {
      return [];
    }

    const status = getStringProperty(checkValue, "status") ?? "unknown";

    if (status === "healthy" || status === "not_configured") {
      return [];
    }

    return [
      {
        check: checkName,
        details: checkValue,
        occurredAt: getIssueOccurredAt(checkName, checkValue),
        reason: getHealthIssueReason(checkName, checkValue, status),
        severity: status === "unhealthy" ? "error" : "warn",
        status,
      },
    ];
  });
}

function getIssueOccurredAt(
  checkName: string,
  check: Record<string, unknown>,
): string | null {
  if (checkName === "recent_failures") {
    return getStringProperty(check, "lastFailureAt") ?? null;
  }

  return (
    getStringProperty(check, "last_failure_at") ??
    getStringProperty(check, "updatedAt") ??
    getStringProperty(check, "updated_at") ??
    null
  );
}

function getHealthIssueReason(
  checkName: string,
  check: Record<string, unknown>,
  status: string,
): string {
  if (checkName === "discord") {
    const pingMs = getNumberProperty(check, "ping_ms");

    return pingMs === null
      ? "Discord client is not ready, so gateway actions may fail."
      : `Discord client is reporting ${status} with ${String(pingMs)}ms gateway ping.`;
  }

  if (checkName === "recent_failures") {
    const errorCount = getNumberProperty(check, "errorCount") ?? 0;
    const warnCount = getNumberProperty(check, "warnCount") ?? 0;
    const windowSeconds = getNumberProperty(check, "windowSeconds") ?? 0;
    const unhealthyErrorThreshold =
      getNumberProperty(check, "unhealthyErrorThreshold") ?? 0;
    const summary =
      errorCount > 0 && warnCount > 0
        ? `${String(errorCount)} error(s) and ${String(warnCount)} warning(s)`
        : errorCount > 0
          ? `${String(errorCount)} error(s)`
          : `${String(warnCount)} warning(s)`;
    const threshold =
      unhealthyErrorThreshold > 0
        ? ` The unhealthy threshold is ${String(unhealthyErrorThreshold)} recent error(s).`
        : "";

    return `${summary} affected health in the last ${formatSeconds(windowSeconds)}.${threshold}`;
  }

  if (checkName === "guild_automation_queue") {
    const failedLastWindow = getNumberProperty(check, "failedLastWindow") ?? 0;
    const oldestQueuedSeconds = getNumberProperty(check, "oldestQueuedSeconds");
    const stuckProcessing = getNumberProperty(check, "stuckProcessing") ?? 0;
    const queued = getNumberProperty(check, "queued") ?? 0;

    if (stuckProcessing > 0) {
      return `${String(stuckProcessing)} guild automation job(s) are stuck processing.`;
    }

    if (failedLastWindow > 0) {
      return `${String(failedLastWindow)} guild automation job(s) failed in the recent health window.`;
    }

    if (oldestQueuedSeconds !== null) {
      return `The oldest queued guild automation job has waited ${formatSeconds(oldestQueuedSeconds)}.`;
    }

    return `${String(queued)} guild automation job(s) are queued.`;
  }

  if (checkName === "guild_member_cache") {
    const failedGuildCount = getNumberProperty(check, "failedGuildCount") ?? 0;
    const staleGuildCount = getNumberProperty(check, "staleGuildCount") ?? 0;
    const oldestCacheAgeSeconds = getNumberProperty(check, "oldestCacheAgeSeconds");
    const running = check.running;

    if (running === false) {
      return "Guild member cache scheduler is not running.";
    }

    if (failedGuildCount > 0) {
      return `${String(failedGuildCount)} linked guild member cache refresh(es) failed.`;
    }

    if (staleGuildCount > 0) {
      const age =
        oldestCacheAgeSeconds === null
          ? ""
          : ` Oldest cache age is ${formatSeconds(oldestCacheAgeSeconds)}.`;

      return `${String(staleGuildCount)} linked guild member cache(s) are stale.${age}`;
    }
  }

  return `${humanizeKey(checkName)} is ${status}.`;
}

async function syncLiveGuildRuntime(options: AdminApiOptions): Promise<void> {
  const store = options.context.adminStore;

  if (!store) {
    return;
  }

  const guilds = [...options.client.guilds.cache.values()];

  await Promise.all(
    guilds.map(async (guild) => {
      const settings = await options.context.guildSettings.get(guild.id);

      await store.recordGuildRuntime({
        botPermissions: guild.members.me?.permissions.bitfield.toString() ?? null,
        discordGuildId: guild.id,
        linkedAt: settings.linkedAt ?? null,
        memberCount: typeof guild.memberCount === "number" ? guild.memberCount : null,
        name: guild.name,
        unavailable: !guild.available,
      });
    }),
  );
}

function createUserDmQueueSummary(context: BotContext): Record<string, unknown> {
  const queues = context.userDmRateLimiter?.getQueueSnapshot() ?? [];

  return {
    cooldownUsers: queues.filter(
      (queue) => queue.sentInWindow > 0 || queue.nextAttemptAt !== null,
    ).length,
    queuedMessages: queues.reduce((total, queue) => total + queue.queueLength, 0),
    queuedUsers: queues.filter((queue) => queue.queueLength > 0).length,
    queues,
  };
}

function getLimit(url: URL): number {
  const value = Number(url.searchParams.get("limit") ?? "100");

  return Number.isFinite(value) ? Math.max(1, Math.min(500, Math.floor(value))) : 100;
}

function getLogLimit(url: URL): number {
  const value = Number(url.searchParams.get("limit") ?? "10000");

  return Number.isFinite(value)
    ? Math.max(1, Math.min(10_000, Math.floor(value)))
    : 10_000;
}

function isAuthorized(request: IncomingMessage, expectedToken: string): boolean {
  const authorization = request.headers.authorization;
  const bearerToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined;
  const adminToken = getSingleHeader(request, "x-admin-token");
  const providedToken = bearerToken ?? adminToken;

  return providedToken ? timingSafeStringEqual(providedToken, expectedToken) : false;
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.byteLength === rightBuffer.byteLength &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function getSingleHeader(request: IncomingMessage, header: string): string | undefined {
  const value = request.headers[header];

  if (Array.isArray(value)) {
    return value.at(0);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getStringProperty(
  record: Record<string, unknown>,
  property: string,
): string | undefined {
  const value = record[property];

  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getNumberProperty(
  record: Record<string, unknown>,
  property: string,
): number | null {
  const value = record[property];

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatSeconds(value: number): string {
  if (value < 60) {
    return `${String(value)}s`;
  }

  if (value < 3600) {
    return `${String(Math.round(value / 60))}m`;
  }

  return `${String(Math.round(value / 3600))}h`;
}

function humanizeKey(value: string): string {
  return value
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);

  response.writeHead(statusCode, {
    "content-length": Buffer.byteLength(payload),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(payload);
}
