import { computed, type Ref } from "vue";
import type { DashboardPayload } from "../../../src/shared/contracts.js";
import {
  createCartesianOptions,
  createDailyTotalsOptions,
  createDonutOptions,
  createHorizontalBarOptions,
  createSeries,
} from "../lib/charts.js";
import {
  capitalize,
  formatDateLabel,
  formatGuildName,
  formatHourLabel,
  formatNullableNumber,
  formatNumber,
} from "../lib/formatters.js";
export function useDashboardMetrics(
  dashboard: Ref<DashboardPayload | null>,
  selectedGuildId: Ref<string>,
) {
  const isLoggedIn = computed(() => dashboard.value !== null);

  const metrics = computed(() => dashboard.value?.metrics);

  const totals = computed(() => metrics.value?.totals);

  const healthIssues = computed(() => dashboard.value?.diagnostics.healthIssues ?? []);

  const recentFailures = computed(
    () => dashboard.value?.diagnostics.recentFailures ?? [],
  );

  const guildDetails = computed(() => dashboard.value?.guilds.details ?? []);

  const selectedGuild = computed(
    () =>
      guildDetails.value.find(
        (guildDashboard) => guildDashboard.guild.discordGuildId === selectedGuildId.value,
      ) ??
      guildDetails.value[0] ??
      null,
  );

  const queueDepth = computed(
    () =>
      (dashboard.value?.queue.guildAutomation.jobsByStatus.queued ?? 0) +
      (dashboard.value?.queue.guildAutomation.jobsByStatus.processing ?? 0) +
      (dashboard.value?.queue.userDms.queuedMessages ?? 0),
  );

  const healthTone = computed(() => dashboard.value?.health.status ?? "unknown");

  const healthSubtitle = computed(() => {
    if (healthIssues.value.length === 0) {
      return "All health checks are currently clear.";
    }

    return healthIssues.value[0]?.reason ?? "One or more health checks need attention.";
  });

  const statCards = computed(() => [
    {
      label: "Health",
      subvalue: `${String(healthIssues.value.length)} active issue(s)`,
      tone: healthTone.value,
      value: capitalize(healthTone.value),
    },
    {
      label: "Events 24h",
      subvalue: `${String(totals.value?.eventsFailed24h ?? 0)} failed`,
      value: formatNumber(totals.value?.events24h ?? 0),
    },
    {
      label: "DMs Sent 24h",
      subvalue: `${String(totals.value?.dmsQueued24h ?? 0)} queued`,
      value: formatNumber(totals.value?.dmsSent24h ?? 0),
    },
    {
      label: "Guild Messages 24h",
      subvalue: `${String(totals.value?.guildMessagesFailed24h ?? 0)} failed`,
      value: formatNumber(totals.value?.guildMessagesSent24h ?? 0),
    },
    {
      label: "Commands 24h",
      subvalue: `${String(totals.value?.commandsFailed24h ?? 0)} failed`,
      value: formatNumber(totals.value?.commandsUsed24h ?? 0),
    },
    {
      label: "Queue Depth",
      subvalue: `${String(dashboard.value?.queue.userDms.queuedUsers ?? 0)} DM users`,
      value: formatNumber(queueDepth.value),
    },
    {
      label: "Guilds",
      subvalue: `${String(dashboard.value?.guilds.linked ?? 0)} linked`,
      value: formatNumber(dashboard.value?.guilds.total ?? 0),
    },
  ]);

  const activitySeries = computed(() => [
    createSeries("Events", "events", metrics.value?.trends.daily7d ?? []),
    createSeries("DMs Sent", "dms", metrics.value?.trends.daily7d ?? []),
    createSeries("Guild Messages", "guildMessages", metrics.value?.trends.daily7d ?? []),
    createSeries("Commands", "commands", metrics.value?.trends.daily7d ?? []),
    createSeries("Failures", "failures", metrics.value?.trends.daily7d ?? []),
  ]);

  const hourlySeries = computed(() => [
    createSeries("Events", "events", metrics.value?.trends.hourly24h ?? []),
    createSeries("DMs Sent", "dms", metrics.value?.trends.hourly24h ?? []),
    createSeries("Commands", "commands", metrics.value?.trends.hourly24h ?? []),
  ]);

  const automationSeries = computed(() => [
    createSeries(
      "Automation Runs",
      "automationRuns",
      metrics.value?.trends.daily7d ?? [],
    ),
    createSeries("Failures", "failures", metrics.value?.trends.daily7d ?? []),
  ]);

  const selectedGuildSeries = computed(() => [
    createSeries("Events", "events", selectedGuild.value?.trends.daily7d ?? []),
    createSeries(
      "Guild Messages",
      "guildMessages",
      selectedGuild.value?.trends.daily7d ?? [],
    ),
    createSeries("Commands", "commands", selectedGuild.value?.trends.daily7d ?? []),
    createSeries(
      "Automation",
      "automationRuns",
      selectedGuild.value?.trends.daily7d ?? [],
    ),
    createSeries("Failures", "failures", selectedGuild.value?.trends.daily7d ?? []),
  ]);

  const dailyLabels = computed(
    () =>
      metrics.value?.trends.daily7d.map((bucket) => formatDateLabel(bucket.label)) ?? [],
  );

  const selectedGuildLabels = computed(
    () =>
      selectedGuild.value?.trends.daily7d.map((bucket) =>
        formatDateLabel(bucket.label),
      ) ?? [],
  );

  const hourlyLabels = computed(
    () =>
      metrics.value?.trends.hourly24h.map((bucket) => formatHourLabel(bucket.label)) ??
      [],
  );

  const activityChartOptions = computed(() =>
    createDailyTotalsOptions(dailyLabels.value, "Daily activity totals"),
  );

  const hourlyChartOptions = computed(() =>
    createCartesianOptions(hourlyLabels.value, "Activity over the past 24 hours"),
  );

  const donutOptions = computed(() =>
    createDonutOptions(metrics.value?.breakdowns.dmStatuses24h ?? []),
  );

  const eventOptions = computed(() =>
    createHorizontalBarOptions(metrics.value?.breakdowns.eventTypes24h ?? []),
  );

  const notificationOptions = computed(() =>
    createHorizontalBarOptions(metrics.value?.breakdowns.notificationTypes24h ?? []),
  );

  const automationOptions = computed(() =>
    createDailyTotalsOptions(dailyLabels.value, "Daily automation totals"),
  );

  const selectedGuildOptions = computed(() =>
    createDailyTotalsOptions(
      selectedGuildLabels.value,
      `${formatGuildName(selectedGuild.value?.guild)} daily totals`,
    ),
  );

  const selectedGuildStatCards = computed(() => {
    const guildDashboard = selectedGuild.value;
    const guild = guildDashboard?.guild;
    const guildTotals = guildDashboard?.totals;

    return [
      {
        label: "Guild Health",
        subvalue: `${String(guildDashboard?.health.issues.length ?? 0)} issue(s)`,
        value: capitalize(guildDashboard?.health.status ?? "unknown"),
      },
      {
        label: "Members",
        subvalue: `${formatNullableNumber(guild?.cachedMemberCount)} cached`,
        value: formatNullableNumber(guild?.memberCount),
      },
      {
        label: "Events 24h",
        subvalue: `${String(guildTotals?.eventFailures24h ?? 0)} failed`,
        value: formatNumber(guildTotals?.events24h ?? 0),
      },
      {
        label: "Guild Messages 24h",
        subvalue: `${String(guildTotals?.guildMessageFailures24h ?? 0)} failed`,
        value: formatNumber(guildTotals?.guildMessagesSent24h ?? 0),
      },
      {
        label: "Commands 24h",
        subvalue: `${String(guildTotals?.commandFailures24h ?? 0)} failed`,
        value: formatNumber(guildTotals?.commands24h ?? 0),
      },
      {
        label: "Automation 24h",
        subvalue: `${String(guildTotals?.automationFailures24h ?? 0)} partial/failed`,
        value: formatNumber(guildTotals?.automationRuns24h ?? 0),
      },
    ];
  });

  const dmStatusSeries = computed(() =>
    (metrics.value?.breakdowns.dmStatuses24h ?? []).map((item) => item.value),
  );

  const eventSeries = computed(() => [
    {
      data: (metrics.value?.breakdowns.eventTypes24h ?? []).map((item) => item.value),
      name: "Events",
    },
  ]);

  const notificationSeries = computed(() => [
    {
      data: (metrics.value?.breakdowns.notificationTypes24h ?? []).map(
        (item) => item.value,
      ),
      name: "Notifications",
    },
  ]);
  return {
    isLoggedIn,
    metrics,
    totals,
    healthIssues,
    recentFailures,
    guildDetails,
    selectedGuild,
    queueDepth,
    healthTone,
    healthSubtitle,
    statCards,
    activitySeries,
    hourlySeries,
    automationSeries,
    selectedGuildSeries,
    dailyLabels,
    selectedGuildLabels,
    hourlyLabels,
    activityChartOptions,
    hourlyChartOptions,
    donutOptions,
    eventOptions,
    notificationOptions,
    automationOptions,
    selectedGuildOptions,
    selectedGuildStatCards,
    dmStatusSeries,
    eventSeries,
    notificationSeries,
  };
}
