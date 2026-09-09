import type {
  AdminFailureRecord,
  AdminGuildDashboardRecord,
  AdminGuildDashboardTotals,
  AdminGuildHealthIssue,
  AdminGuildRecord,
} from "../../shared/telemetry.js";

export function createGuildHealth(
  guild: AdminGuildRecord,
  totals: AdminGuildDashboardTotals,
  recentFailures: AdminFailureRecord[],
): AdminGuildDashboardRecord["health"] {
  const issues: AdminGuildHealthIssue[] = [];
  const addIssue = (issue: AdminGuildHealthIssue): void => {
    issues.push(issue);
  };

  if (guild.unavailable) {
    addIssue({
      key: "guild_unavailable",
      occurredAt: guild.lastSeenAt,
      reason: "Discord currently reports this guild as unavailable.",
      severity: "error",
      status: "unhealthy",
    });
  }

  if (!guild.linked) {
    addIssue({
      key: "guild_not_linked",
      occurredAt: guild.lastSeenAt,
      reason:
        "This guild is not linked to a FullParty group, so guild automation will not run.",
      severity: "warn",
      status: "degraded",
    });
  }

  if (guild.linked && !guild.botLogChannelId) {
    addIssue({
      key: "bot_log_channel_missing",
      occurredAt: guild.updatedAt,
      reason:
        "Bot Log channel is not configured, so operational messages may be skipped.",
      severity: "warn",
      status: "degraded",
    });
  }

  if (guild.linked && !guild.runAnnouncementChannelId) {
    addIssue({
      key: "member_facing_channel_missing",
      occurredAt: guild.updatedAt,
      reason: "Member-Facing Channel is not configured.",
      severity: "warn",
      status: "degraded",
    });
  }

  if (guild.linked && !guild.upcomingRaiderRoleId) {
    addIssue({
      key: "template_role_missing",
      occurredAt: guild.updatedAt,
      reason: "Template Role is not configured, so run role creation cannot work.",
      severity: "warn",
      status: "degraded",
    });
  }

  if (guild.linked && guild.refreshStatus === "failed") {
    addIssue({
      key: "member_cache_failed",
      occurredAt: guild.updatedAt,
      reason: guild.lastError
        ? `Guild member cache refresh failed: ${guild.lastError}`
        : "Guild member cache refresh failed.",
      severity: "warn",
      status: "degraded",
    });
  } else if (
    guild.linked &&
    guild.refreshStatus !== null &&
    guild.refreshStatus !== "fresh"
  ) {
    addIssue({
      key: "member_cache_not_fresh",
      occurredAt: guild.updatedAt,
      reason: `Guild member cache is ${guild.refreshStatus}.`,
      severity: "warn",
      status: "degraded",
    });
  }

  if (totals.healthFailures24h > 0) {
    const recentHealthFailure = recentFailures.find((failure) => failure.affectsHealth);
    const hasError = recentFailures.some(
      (failure) => failure.affectsHealth && failure.severity === "error",
    );

    addIssue({
      key: "health_failures_24h",
      occurredAt: recentHealthFailure?.occurredAt ?? null,
      reason: `${String(totals.healthFailures24h)} health-impacting failure(s) were recorded in the last 24h.`,
      severity: hasError ? "error" : "warn",
      status: hasError ? "unhealthy" : "degraded",
    });
  }

  if (totals.automationFailures24h > 0) {
    addIssue({
      key: "automation_failures_24h",
      occurredAt: null,
      reason: `${String(totals.automationFailures24h)} guild automation run(s) were partial or failed in the last 24h.`,
      severity: "warn",
      status: "degraded",
    });
  }

  if (totals.guildMessageFailures24h > 0) {
    addIssue({
      key: "guild_message_failures_24h",
      occurredAt: null,
      reason: `${String(totals.guildMessageFailures24h)} guild message(s) failed to send in the last 24h.`,
      severity: "warn",
      status: "degraded",
    });
  }

  const status = issues.some((issue) => issue.status === "unhealthy")
    ? "unhealthy"
    : issues.length > 0
      ? "degraded"
      : "healthy";

  return {
    issues,
    status,
  };
}
