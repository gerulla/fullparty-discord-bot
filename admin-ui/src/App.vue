<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

type MetricBucket = {
  automationRuns: number;
  commands: number;
  dms: number;
  events: number;
  failures: number;
  guildMessages: number;
  label: string;
};

type LabeledCount = {
  label: string;
  value: number;
};

type DashboardMetrics = {
  breakdowns: {
    automationStatuses24h: LabeledCount[];
    commandNames24h: LabeledCount[];
    dmStatuses24h: LabeledCount[];
    eventTypes24h: LabeledCount[];
    guildMessageStatuses24h: LabeledCount[];
    notificationTypes24h: LabeledCount[];
  };
  totals: {
    automationFailures24h: number;
    automationRuns24h: number;
    commandsFailed24h: number;
    commandsUsed24h: number;
    dmsFailed24h: number;
    dmsQueued24h: number;
    dmsSent24h: number;
    events24h: number;
    eventsFailed24h: number;
    failures24h: number;
    guildMessagesFailed24h: number;
    guildMessagesSent24h: number;
  };
  trends: {
    daily7d: MetricBucket[];
    hourly24h: MetricBucket[];
  };
};

type HealthIssue = {
  check: string;
  details: Record<string, unknown>;
  occurredAt: string | null;
  reason: string;
  severity: "info" | "warn" | "error";
  status: string;
};

type FailureRecord = {
  action: string;
  affectsHealth: boolean;
  details: unknown;
  discordGuildId: string | null;
  discordUserId: string | null;
  errorCode: string | null;
  eventType: string | null;
  id: number;
  message: string;
  occurredAt: string;
  runId: number | null;
  severity: string;
  source: string;
};

type GuildRecord = {
  botLogChannelId: string | null;
  botModeratorRoleId: string | null;
  botPermissions: string | null;
  cachedMemberCount: number | null;
  discordGuildId: string;
  lastError: string | null;
  lastFullRefreshAt: string | null;
  lastSeenAt: string | null;
  linked: boolean;
  linkedAt: string | null;
  memberCount: number | null;
  name: string | null;
  nextRefreshAfter: string | null;
  refreshStatus: string | null;
  runAnnouncementChannelId: string | null;
  syncDiscordNamesToFf14: boolean;
  unavailable: boolean;
  upcomingRaiderRoleId: string | null;
  updatedAt: string | null;
};

type GuildHealthIssue = {
  key: string;
  occurredAt: string | null;
  reason: string;
  severity: "warn" | "error";
  status: string;
};

type CommandUsageRecord = {
  commandName: string;
  discordGuildId: string | null;
  discordUserId: string | null;
  durationMs: number | null;
  errorCode: string | null;
  id: number;
  occurredAt: string;
  status: string;
};

type GuildMessageRecord = {
  channelId: string | null;
  discordGuildId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  id: number;
  messageId: string | null;
  messageType: string;
  occurredAt: string;
  status: string;
};

type AutomationRunRecord = {
  automationType: string;
  discordGuildId: string | null;
  durationMs: number | null;
  eventType: string | null;
  failureCount: number;
  id: number;
  occurredAt: string;
  result: unknown;
  runId: number | null;
  skippedCount: number;
  status: string;
  successCount: number;
};

type BotEventRecord = {
  dataType: string | null;
  discordGuildId: string | null;
  discordUserId: string | null;
  errorCode: string | null;
  eventType: string;
  id: number;
  occurredAt: string;
  requestHost: string | null;
  requestId: string | null;
  status: string;
};

type GuildDashboardRecord = {
  guild: GuildRecord;
  health: {
    issues: GuildHealthIssue[];
    status: string;
  };
  recent: {
    automationRuns: AutomationRunRecord[];
    commandUsages: CommandUsageRecord[];
    events: BotEventRecord[];
    failures: FailureRecord[];
    guildMessages: GuildMessageRecord[];
  };
  totals: {
    automationFailures24h: number;
    automationRuns24h: number;
    commandFailures24h: number;
    commands24h: number;
    eventFailures24h: number;
    events24h: number;
    guildMessageFailures24h: number;
    guildMessagesSent24h: number;
    healthFailures24h: number;
    ignoredFailures24h: number;
  };
  trends: {
    daily7d: MetricBucket[];
  };
};

type DashboardPayload = {
  diagnostics?: {
    healthIssues?: HealthIssue[];
    recentFailures?: FailureRecord[];
  };
  guilds: {
    details?: GuildDashboardRecord[];
    linked: number;
    records?: GuildRecord[];
    total: number;
    unavailable: number;
  };
  health: {
    checks?: Record<string, unknown>;
    ok?: boolean;
    status?: string;
    uptime_seconds?: number;
  };
  metrics: DashboardMetrics;
  queue: {
    guildAutomation?: {
      jobsByStatus?: Record<string, number>;
      oldestQueuedAt?: string | null;
      recentFailedCount?: number;
    };
    userDms?: {
      cooldownUsers?: number;
      queuedMessages?: number;
      queuedUsers?: number;
    };
  };
};

type DashboardResponse = {
  data: DashboardPayload;
};

type RuntimeLogEntry = {
  id: number;
  level: "debug" | "error" | "info" | "log" | "warn";
  message: string;
  timestamp: string;
};

type RuntimeLogsResponse = {
  data: RuntimeLogEntry[];
  meta: {
    directoryPath?: string | null;
    enabled?: boolean;
    limit: number;
    maxLines: number;
    retentionDays?: number | null;
    totalBuffered: number;
  };
};

const storageKey = "fullparty.adminApiToken";
const sections = [
  "Overview",
  "Events",
  "Messaging",
  "Guilds",
  "Automation",
  "Failures",
  "Log",
];
const chartColors = ["#a78bfa", "#38bdf8", "#22c55e", "#f59e0b", "#ef4444", "#f472b6"];

const activeSection = ref("Overview");
const token = ref("");
const isLoading = ref(false);
const errorMessage = ref("");
const dashboard = ref<DashboardPayload | null>(null);
const selectedGuildId = ref("");
const runtimeLogs = ref<RuntimeLogEntry[]>([]);
const runtimeLogMeta = ref<RuntimeLogsResponse["meta"] | null>(null);
const isLogLoading = ref(false);
const logErrorMessage = ref("");
const isMemberCacheRefreshing = ref(false);
const memberCacheRefreshMessage = ref("");
let logPollInterval: ReturnType<typeof window.setInterval> | undefined;

const isLoggedIn = computed(() => dashboard.value !== null);
const metrics = computed(() => dashboard.value?.metrics);
const totals = computed(() => metrics.value?.totals);
const healthIssues = computed(() => dashboard.value?.diagnostics?.healthIssues ?? []);
const recentFailures = computed(() => dashboard.value?.diagnostics?.recentFailures ?? []);
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
    (dashboard.value?.queue.guildAutomation?.jobsByStatus?.queued ?? 0) +
    (dashboard.value?.queue.guildAutomation?.jobsByStatus?.processing ?? 0) +
    (dashboard.value?.queue.userDms?.queuedMessages ?? 0),
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
    subvalue: `${String(dashboard.value?.queue.userDms?.queuedUsers ?? 0)} DM users`,
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
  createSeries("Automation Runs", "automationRuns", metrics.value?.trends.daily7d ?? []),
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
  createSeries("Automation", "automationRuns", selectedGuild.value?.trends.daily7d ?? []),
  createSeries("Failures", "failures", selectedGuild.value?.trends.daily7d ?? []),
]);

const dailyLabels = computed(
  () =>
    metrics.value?.trends.daily7d.map((bucket) => formatDateLabel(bucket.label)) ?? [],
);
const selectedGuildLabels = computed(
  () =>
    selectedGuild.value?.trends.daily7d.map((bucket) => formatDateLabel(bucket.label)) ??
    [],
);
const hourlyLabels = computed(
  () =>
    metrics.value?.trends.hourly24h.map((bucket) => formatHourLabel(bucket.label)) ?? [],
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
const commandOptions = computed(() =>
  createHorizontalBarOptions(metrics.value?.breakdowns.commandNames24h ?? []),
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
const commandSeries = computed(() => [
  {
    data: (metrics.value?.breakdowns.commandNames24h ?? []).map((item) => item.value),
    name: "Uses",
  },
]);
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

onMounted(() => {
  const savedToken = sessionStorage.getItem(storageKey);

  if (savedToken) {
    token.value = savedToken;
    void login();
  }
});

onBeforeUnmount(() => {
  stopLogPolling();
});

watch([activeSection, isLoggedIn], () => {
  syncLogPolling();
});

async function login(): Promise<void> {
  const trimmedToken = token.value.trim();

  if (!trimmedToken) {
    errorMessage.value = "Enter your admin API token.";
    return;
  }

  isLoading.value = true;
  errorMessage.value = "";

  try {
    const nextDashboard = await fetchDashboard(trimmedToken);

    dashboard.value = nextDashboard;
    syncSelectedGuild(nextDashboard);
    sessionStorage.setItem(storageKey, trimmedToken);
  } catch (error) {
    dashboard.value = null;
    sessionStorage.removeItem(storageKey);
    errorMessage.value = error instanceof Error ? error.message : "Unable to log in.";
  } finally {
    isLoading.value = false;
  }
}

async function refreshDashboard(): Promise<void> {
  const savedToken = sessionStorage.getItem(storageKey);

  if (!savedToken) {
    logout();
    return;
  }

  isLoading.value = true;
  errorMessage.value = "";

  try {
    const nextDashboard = await fetchDashboard(savedToken);

    dashboard.value = nextDashboard;
    syncSelectedGuild(nextDashboard);
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to refresh dashboard.";
  } finally {
    isLoading.value = false;
  }
}

async function refreshGuildMemberCache(): Promise<void> {
  const savedToken = sessionStorage.getItem(storageKey);

  if (!savedToken) {
    logout();
    return;
  }

  isMemberCacheRefreshing.value = true;
  memberCacheRefreshMessage.value = "";

  try {
    const response = await fetch("/admin/api/guild-member-cache/refresh", {
      headers: {
        authorization: `Bearer ${savedToken}`,
      },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(
        response.status === 401
          ? "Invalid token."
          : "Unable to queue guild member cache refresh.",
      );
    }

    const body = (await response.json()) as {
      data: {
        deletedUnavailableGuildCount: number;
        linkedGuildCount: number;
        obsoleteUnavailableGuildCount?: number;
        queuedGuildCount: number;
        skippedGuildCount: number;
      };
    };
    const obsoleteUnavailableGuildCount =
      body.data.obsoleteUnavailableGuildCount ?? body.data.deletedUnavailableGuildCount;

    memberCacheRefreshMessage.value = [
      `Queued ${formatNumber(body.data.queuedGuildCount)} linked guild refresh job(s).`,
      body.data.skippedGuildCount > 0
        ? `${formatNumber(body.data.skippedGuildCount)} already queued/running.`
        : "",
      obsoleteUnavailableGuildCount > 0
        ? `${formatNumber(obsoleteUnavailableGuildCount)} unavailable cache row(s) marked obsolete.`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    await refreshDashboard();
  } catch (error) {
    memberCacheRefreshMessage.value =
      error instanceof Error
        ? error.message
        : "Unable to queue guild member cache refresh.";
  } finally {
    isMemberCacheRefreshing.value = false;
  }
}

async function fetchDashboard(apiToken: string): Promise<DashboardPayload> {
  const response = await fetch("/admin/api/metrics", {
    headers: {
      authorization: `Bearer ${apiToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(
      response.status === 401 ? "Invalid token." : "Admin API unavailable.",
    );
  }

  const body = (await response.json()) as DashboardResponse;

  return body.data;
}

function syncSelectedGuild(nextDashboard: DashboardPayload): void {
  const guilds = nextDashboard.guilds.details ?? [];

  if (guilds.length === 0) {
    selectedGuildId.value = "";
    return;
  }

  if (
    selectedGuildId.value &&
    guilds.some(
      (guildDashboard) => guildDashboard.guild.discordGuildId === selectedGuildId.value,
    )
  ) {
    return;
  }

  selectedGuildId.value =
    guilds.find((guildDashboard) => guildDashboard.guild.linked)?.guild.discordGuildId ??
    guilds[0]?.guild.discordGuildId ??
    "";
}

function logout(): void {
  token.value = "";
  dashboard.value = null;
  errorMessage.value = "";
  selectedGuildId.value = "";
  runtimeLogs.value = [];
  runtimeLogMeta.value = null;
  logErrorMessage.value = "";
  memberCacheRefreshMessage.value = "";
  stopLogPolling();
  sessionStorage.removeItem(storageKey);
}

async function refreshLogs(): Promise<void> {
  const savedToken = sessionStorage.getItem(storageKey);

  if (!savedToken) {
    stopLogPolling();
    return;
  }

  isLogLoading.value = runtimeLogs.value.length === 0;
  logErrorMessage.value = "";

  try {
    const response = await fetch("/admin/api/logs?limit=10000", {
      headers: {
        authorization: `Bearer ${savedToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(
        response.status === 401 ? "Invalid token." : "Log API unavailable.",
      );
    }

    const body = (await response.json()) as RuntimeLogsResponse;

    runtimeLogs.value = body.data;
    runtimeLogMeta.value = body.meta;
  } catch (error) {
    logErrorMessage.value =
      error instanceof Error ? error.message : "Unable to refresh logs.";
  } finally {
    isLogLoading.value = false;
  }
}

function syncLogPolling(): void {
  if (activeSection.value !== "Log" || !isLoggedIn.value) {
    stopLogPolling();
    return;
  }

  if (!logPollInterval) {
    void refreshLogs();
    logPollInterval = window.setInterval(() => {
      void refreshLogs();
    }, 2_000);
  }
}

function stopLogPolling(): void {
  if (!logPollInterval) {
    return;
  }

  window.clearInterval(logPollInterval);
  logPollInterval = undefined;
}

function createSeries(
  name: string,
  key: keyof Omit<MetricBucket, "label">,
  buckets: MetricBucket[],
) {
  return {
    data: buckets.map((bucket) => bucket[key]),
    name,
  };
}

function createCartesianOptions(categories: string[], title: string) {
  return {
    chart: {
      background: "transparent",
      fontFamily: "Inter, ui-sans-serif, system-ui",
      foreColor: "#bdb6ce",
      toolbar: { show: false },
    },
    colors: chartColors,
    dataLabels: { enabled: false },
    grid: {
      borderColor: "rgba(196, 181, 253, 0.12)",
      strokeDashArray: 4,
    },
    legend: {
      labels: { colors: "#d8d2e8" },
      markers: { radius: 4 },
    },
    stroke: {
      curve: "smooth",
      width: 3,
    },
    theme: { mode: "dark" },
    title: {
      style: { color: "#fbfaff", fontSize: "14px", fontWeight: 700 },
      text: title,
    },
    tooltip: {
      theme: "dark",
    },
    xaxis: {
      axisBorder: { color: "rgba(196, 181, 253, 0.18)" },
      axisTicks: { color: "rgba(196, 181, 253, 0.18)" },
      categories,
      labels: {
        style: { colors: "#a9a0b8" },
      },
    },
    yaxis: {
      labels: {
        style: { colors: "#a9a0b8" },
      },
    },
  };
}

function createDailyTotalsOptions(categories: string[], title: string) {
  return {
    chart: {
      background: "transparent",
      fontFamily: "Inter, ui-sans-serif, system-ui",
      foreColor: "#bdb6ce",
      stacked: false,
      toolbar: { show: false },
    },
    colors: chartColors,
    dataLabels: { enabled: false },
    grid: {
      borderColor: "rgba(196, 181, 253, 0.12)",
      strokeDashArray: 4,
    },
    legend: {
      labels: { colors: "#d8d2e8" },
      markers: { radius: 4 },
    },
    plotOptions: {
      bar: {
        borderRadius: 4,
        columnWidth: "58%",
      },
    },
    stroke: {
      colors: ["transparent"],
      width: 1,
    },
    theme: { mode: "dark" },
    title: {
      style: { color: "#fbfaff", fontSize: "14px", fontWeight: 700 },
      text: title,
    },
    tooltip: {
      shared: false,
      theme: "dark",
    },
    xaxis: {
      axisBorder: { color: "rgba(196, 181, 253, 0.18)" },
      axisTicks: { color: "rgba(196, 181, 253, 0.18)" },
      categories,
      labels: {
        style: { colors: "#a9a0b8" },
      },
    },
    yaxis: {
      decimalsInFloat: 0,
      labels: {
        style: { colors: "#a9a0b8" },
      },
    },
  };
}

function createDonutOptions(items: LabeledCount[]) {
  return {
    chart: {
      background: "transparent",
      fontFamily: "Inter, ui-sans-serif, system-ui",
      foreColor: "#d8d2e8",
    },
    colors: chartColors,
    labels: items.map((item) => capitalize(item.label)),
    legend: {
      labels: { colors: "#d8d2e8" },
      position: "bottom",
    },
    plotOptions: {
      pie: {
        donut: {
          labels: {
            show: true,
            total: {
              color: "#fbfaff",
              show: true,
            },
          },
        },
      },
    },
    stroke: { colors: ["#111017"] },
    theme: { mode: "dark" },
  };
}

function createHorizontalBarOptions(items: LabeledCount[]) {
  return {
    chart: {
      background: "transparent",
      fontFamily: "Inter, ui-sans-serif, system-ui",
      foreColor: "#d8d2e8",
      toolbar: { show: false },
    },
    colors: ["#a78bfa"],
    dataLabels: { enabled: false },
    grid: {
      borderColor: "rgba(196, 181, 253, 0.12)",
    },
    plotOptions: {
      bar: {
        borderRadius: 5,
        horizontal: true,
      },
    },
    theme: { mode: "dark" },
    tooltip: { theme: "dark" },
    xaxis: {
      categories: items.map((item) => item.label),
      labels: {
        style: { colors: "#a9a0b8" },
      },
    },
    yaxis: {
      labels: {
        maxWidth: 220,
        style: { colors: "#d8d2e8" },
      },
    },
  };
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatNullableNumber(value: number | null | undefined): string {
  return typeof value === "number" ? formatNumber(value) : "Unknown";
}

function formatDateLabel(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);

  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        day: "2-digit",
        month: "short",
      }).format(date);
}

function formatHourLabel(value: string): string {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        hour12: false,
      }).format(date);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "medium",
      }).format(date);
}

function formatLogTime(value: string): string {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        month: "short",
        second: "2-digit",
      }).format(date);
}

function formatDetails(value: unknown): string {
  if (value === null || value === undefined) {
    return "No extra details captured.";
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function formatFailureTitle(failure: FailureRecord): string {
  return `${humanizeKey(failure.source)} / ${humanizeKey(failure.action)}`;
}

function formatGuildName(guild: GuildRecord | null | undefined): string {
  return guild?.name ?? guild?.discordGuildId ?? "Selected guild";
}

function formatSettingValue(value: string | null | undefined): string {
  return value && value.length > 0 ? value : "Missing";
}

function formatBoolean(value: boolean | null | undefined): string {
  return value ? "On" : "Off";
}

function formatCheckName(value: string): string {
  return humanizeKey(value);
}

function humanizeKey(value: string): string {
  return value
    .split(/[_.-]/u)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}
</script>

<template>
  <main v-if="!isLoggedIn" class="login-shell">
    <section class="login-panel" aria-labelledby="login-title">
      <div class="brand-mark" aria-hidden="true"></div>
      <p class="eyebrow">FullParty Bot</p>
      <h1 id="login-title">Admin Login</h1>
      <form class="token-form" @submit.prevent="login">
        <label for="token">Admin API token</label>
        <input
          id="token"
          v-model="token"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          type="password"
          placeholder="Paste token"
          :disabled="isLoading"
        />
        <button type="submit" :disabled="isLoading">
          {{ isLoading ? "Checking..." : "Log in" }}
        </button>
      </form>
      <p v-if="errorMessage" class="error-message" role="alert">{{ errorMessage }}</p>
    </section>
  </main>

  <main v-else class="dashboard-shell">
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="brand-mark compact" aria-hidden="true"></div>
        <div>
          <p class="eyebrow">FullParty</p>
          <strong>Bot Admin</strong>
        </div>
      </div>
      <nav aria-label="Dashboard sections">
        <button
          v-for="section in sections"
          :key="section"
          class="nav-button"
          :class="{ active: activeSection === section }"
          type="button"
          @click="activeSection = section"
        >
          {{ section }}
        </button>
      </nav>
      <div class="sidebar-footer">
        <button
          class="ghost-button"
          type="button"
          :disabled="isLoading"
          @click="refreshDashboard"
        >
          Refresh
        </button>
        <button class="ghost-button danger" type="button" @click="logout">Log out</button>
      </div>
    </aside>

    <section class="dashboard-main" aria-labelledby="dashboard-title">
      <header class="dashboard-header">
        <div>
          <p class="eyebrow">Live Operations</p>
          <h1 id="dashboard-title">{{ activeSection }}</h1>
        </div>
        <div class="health-pill" :class="healthTone">{{ capitalize(healthTone) }}</div>
      </header>

      <p v-if="errorMessage" class="error-message dashboard-error" role="alert">
        {{ errorMessage }}
      </p>

      <section v-if="activeSection === 'Overview'" class="section-grid">
        <div class="stat-grid">
          <article v-for="card in statCards" :key="card.label" class="stat-card">
            <span>{{ card.label }}</span>
            <strong>{{ card.value }}</strong>
            <small>{{ card.subvalue ?? "Current" }}</small>
          </article>
        </div>

        <article class="panel wide health-panel">
          <div class="panel-heading">
            <div>
              <h2>Health Details</h2>
              <p>{{ healthSubtitle }}</p>
            </div>
            <span class="status-chip" :class="healthTone">{{
              capitalize(healthTone)
            }}</span>
          </div>

          <div v-if="healthIssues.length === 0" class="empty-state">
            No degraded or unhealthy checks right now.
          </div>
          <div v-else class="issue-list">
            <article
              v-for="issue in healthIssues"
              :key="`${issue.check}-${issue.status}-${issue.occurredAt ?? 'now'}`"
              class="issue-card"
              :class="issue.severity"
            >
              <div class="issue-header">
                <div>
                  <strong>{{ formatCheckName(issue.check) }}</strong>
                  <p>{{ issue.reason }}</p>
                </div>
                <span class="status-chip" :class="issue.status">
                  {{ capitalize(issue.status) }}
                </span>
              </div>
              <dl class="compact-details">
                <div>
                  <dt>When</dt>
                  <dd>{{ formatDateTime(issue.occurredAt) }}</dd>
                </div>
                <div>
                  <dt>Check</dt>
                  <dd>{{ issue.check }}</dd>
                </div>
              </dl>
              <details class="json-details">
                <summary>Raw check data</summary>
                <pre>{{ formatDetails(issue.details) }}</pre>
              </details>
            </article>
          </div>
        </article>

        <article class="panel wide">
          <apexchart
            height="330"
            type="bar"
            :options="activityChartOptions"
            :series="activitySeries"
          />
        </article>

        <article class="panel wide">
          <apexchart
            height="300"
            type="line"
            :options="hourlyChartOptions"
            :series="hourlySeries"
          />
        </article>
      </section>

      <section v-else-if="activeSection === 'Events'" class="section-grid two-column">
        <article class="panel">
          <apexchart
            height="330"
            type="bar"
            :options="eventOptions"
            :series="eventSeries"
          />
        </article>
        <article class="panel">
          <apexchart
            height="330"
            type="bar"
            :options="notificationOptions"
            :series="notificationSeries"
          />
        </article>
      </section>

      <section v-else-if="activeSection === 'Messaging'" class="section-grid two-column">
        <article class="panel">
          <apexchart
            height="330"
            type="donut"
            :options="donutOptions"
            :series="dmStatusSeries"
          />
        </article>
        <article class="panel info-panel">
          <h2>Message Delivery</h2>
          <dl>
            <div>
              <dt>DMs Sent</dt>
              <dd>{{ formatNumber(totals?.dmsSent24h ?? 0) }}</dd>
            </div>
            <div>
              <dt>DMs Failed</dt>
              <dd>{{ formatNumber(totals?.dmsFailed24h ?? 0) }}</dd>
            </div>
            <div>
              <dt>Guild Messages Sent</dt>
              <dd>{{ formatNumber(totals?.guildMessagesSent24h ?? 0) }}</dd>
            </div>
            <div>
              <dt>Guild Message Failures</dt>
              <dd>{{ formatNumber(totals?.guildMessagesFailed24h ?? 0) }}</dd>
            </div>
          </dl>
        </article>
      </section>

      <section v-else-if="activeSection === 'Guilds'" class="section-grid">
        <article class="panel wide guild-picker-panel">
          <div class="panel-heading">
            <div>
              <h2>Guild Inspector</h2>
              <p>
                Select a guild the bot is in and inspect its current setup, health, and
                recent activity.
              </p>
            </div>
            <span class="status-chip">
              {{ formatNumber(dashboard?.guilds.total ?? 0) }} guilds
            </span>
          </div>

          <label class="guild-selector" for="guild-selector">
            <span>Selected guild</span>
            <select
              id="guild-selector"
              v-model="selectedGuildId"
              :disabled="guildDetails.length === 0"
            >
              <option
                v-for="guildDashboard in guildDetails"
                :key="guildDashboard.guild.discordGuildId"
                :value="guildDashboard.guild.discordGuildId"
              >
                {{ formatGuildName(guildDashboard.guild) }}
              </option>
            </select>
          </label>
        </article>

        <div v-if="!selectedGuild" class="empty-state">
          No guild runtime records have been captured yet.
        </div>

        <template v-else>
          <article class="panel wide guild-hero-panel">
            <div>
              <p class="eyebrow">Selected Guild</p>
              <h2>{{ formatGuildName(selectedGuild.guild) }}</h2>
              <p>{{ selectedGuild.guild.discordGuildId }}</p>
            </div>
            <div class="guild-chip-row">
              <span class="status-chip" :class="selectedGuild.health.status">
                {{ capitalize(selectedGuild.health.status) }}
              </span>
              <span
                class="status-chip"
                :class="selectedGuild.guild.linked ? 'healthy' : 'degraded'"
              >
                {{ selectedGuild.guild.linked ? "Linked" : "Not linked" }}
              </span>
              <span
                class="status-chip"
                :class="selectedGuild.guild.unavailable ? 'unhealthy' : 'healthy'"
              >
                {{ selectedGuild.guild.unavailable ? "Unavailable" : "Available" }}
              </span>
            </div>
          </article>

          <div class="stat-grid">
            <article
              v-for="card in selectedGuildStatCards"
              :key="`guild-${card.label}`"
              class="stat-card"
            >
              <span>{{ card.label }}</span>
              <strong>{{ card.value }}</strong>
              <small>{{ card.subvalue }}</small>
            </article>
          </div>

          <article class="panel wide">
            <apexchart
              height="320"
              type="bar"
              :options="selectedGuildOptions"
              :series="selectedGuildSeries"
            />
          </article>

          <section class="section-grid two-column">
            <article class="panel info-panel">
              <h2>Runtime & Settings</h2>
              <dl>
                <div>
                  <dt>Last Seen</dt>
                  <dd>{{ formatDateTime(selectedGuild.guild.lastSeenAt) }}</dd>
                </div>
                <div>
                  <dt>Linked At</dt>
                  <dd>{{ formatDateTime(selectedGuild.guild.linkedAt) }}</dd>
                </div>
                <div>
                  <dt>Bot Log Channel</dt>
                  <dd>{{ formatSettingValue(selectedGuild.guild.botLogChannelId) }}</dd>
                </div>
                <div>
                  <dt>Member-Facing Channel</dt>
                  <dd>
                    {{ formatSettingValue(selectedGuild.guild.runAnnouncementChannelId) }}
                  </dd>
                </div>
                <div>
                  <dt>Template Role</dt>
                  <dd>
                    {{ formatSettingValue(selectedGuild.guild.upcomingRaiderRoleId) }}
                  </dd>
                </div>
                <div>
                  <dt>Moderator Role</dt>
                  <dd>
                    {{ formatSettingValue(selectedGuild.guild.botModeratorRoleId) }}
                  </dd>
                </div>
                <div>
                  <dt>Nickname Sync</dt>
                  <dd>{{ formatBoolean(selectedGuild.guild.syncDiscordNamesToFf14) }}</dd>
                </div>
                <div>
                  <dt>Bot Permissions</dt>
                  <dd>{{ selectedGuild.guild.botPermissions ?? "Unknown" }}</dd>
                </div>
              </dl>
            </article>

            <article class="panel info-panel">
              <div class="panel-heading compact-heading">
                <div>
                  <h2>Member Cache</h2>
                  <p>Refresh linked visible guilds and mark unavailable cache rows obsolete.</p>
                </div>
                <button
                  class="inline-button"
                  type="button"
                  :disabled="isMemberCacheRefreshing"
                  @click="refreshGuildMemberCache"
                >
                  {{ isMemberCacheRefreshing ? "Queueing..." : "Force refresh" }}
                </button>
              </div>
              <p v-if="memberCacheRefreshMessage" class="helper-message">
                {{ memberCacheRefreshMessage }}
              </p>
              <dl>
                <div>
                  <dt>Status</dt>
                  <dd>{{ selectedGuild.guild.refreshStatus ?? "Unknown" }}</dd>
                </div>
                <div>
                  <dt>Cached Members</dt>
                  <dd>
                    {{ formatNullableNumber(selectedGuild.guild.cachedMemberCount) }}
                  </dd>
                </div>
                <div>
                  <dt>Discord Members</dt>
                  <dd>{{ formatNullableNumber(selectedGuild.guild.memberCount) }}</dd>
                </div>
                <div>
                  <dt>Last Refresh</dt>
                  <dd>{{ formatDateTime(selectedGuild.guild.lastFullRefreshAt) }}</dd>
                </div>
                <div>
                  <dt>Next Refresh</dt>
                  <dd>{{ formatDateTime(selectedGuild.guild.nextRefreshAfter) }}</dd>
                </div>
                <div>
                  <dt>Last Error</dt>
                  <dd>{{ selectedGuild.guild.lastError ?? "None" }}</dd>
                </div>
              </dl>
            </article>
          </section>

          <article class="panel wide">
            <div class="panel-heading">
              <div>
                <h2>Guild Health</h2>
                <p>Setup and runtime issues for this guild only.</p>
              </div>
              <span class="status-chip" :class="selectedGuild.health.status">
                {{ capitalize(selectedGuild.health.status) }}
              </span>
            </div>
            <div v-if="selectedGuild.health.issues.length === 0" class="empty-state">
              No guild-specific issues found.
            </div>
            <div v-else class="issue-list">
              <article
                v-for="issue in selectedGuild.health.issues"
                :key="issue.key"
                class="issue-card"
                :class="issue.severity"
              >
                <div class="issue-header">
                  <div>
                    <strong>{{ formatCheckName(issue.key) }}</strong>
                    <p>{{ issue.reason }}</p>
                  </div>
                  <span class="status-chip" :class="issue.status">
                    {{ capitalize(issue.status) }}
                  </span>
                </div>
                <dl class="compact-details">
                  <div>
                    <dt>When</dt>
                    <dd>{{ formatDateTime(issue.occurredAt) }}</dd>
                  </div>
                  <div>
                    <dt>Key</dt>
                    <dd>{{ issue.key }}</dd>
                  </div>
                </dl>
              </article>
            </div>
          </article>

          <section class="section-grid two-column">
            <article class="panel recent-panel">
              <h2>Recent Failures</h2>
              <div v-if="selectedGuild.recent.failures.length === 0" class="empty-state">
                No guild-specific failures captured.
              </div>
              <div v-else class="recent-list">
                <article
                  v-for="failure in selectedGuild.recent.failures"
                  :key="failure.id"
                  class="recent-row"
                >
                  <strong>{{ formatFailureTitle(failure) }}</strong>
                  <span>{{ failure.errorCode ?? failure.severity }}</span>
                  <small>{{ formatDateTime(failure.occurredAt) }}</small>
                </article>
              </div>
            </article>

            <article class="panel recent-panel">
              <h2>Recent Automation</h2>
              <div
                v-if="selectedGuild.recent.automationRuns.length === 0"
                class="empty-state"
              >
                No guild automation records captured.
              </div>
              <div v-else class="recent-list">
                <article
                  v-for="automation in selectedGuild.recent.automationRuns"
                  :key="automation.id"
                  class="recent-row"
                >
                  <strong>{{ humanizeKey(automation.automationType) }}</strong>
                  <span>
                    {{ automation.status }} · {{ automation.successCount }} ok /
                    {{ automation.failureCount }} failed
                  </span>
                  <small>{{ formatDateTime(automation.occurredAt) }}</small>
                </article>
              </div>
            </article>

            <article class="panel recent-panel">
              <h2>Recent Guild Messages</h2>
              <div
                v-if="selectedGuild.recent.guildMessages.length === 0"
                class="empty-state"
              >
                No guild message records captured.
              </div>
              <div v-else class="recent-list">
                <article
                  v-for="message in selectedGuild.recent.guildMessages"
                  :key="message.id"
                  class="recent-row"
                >
                  <strong>{{ humanizeKey(message.messageType) }}</strong>
                  <span
                    >{{ message.status
                    }}{{ message.errorCode ? ` · ${message.errorCode}` : "" }}</span
                  >
                  <small>{{ formatDateTime(message.occurredAt) }}</small>
                </article>
              </div>
            </article>

            <article class="panel recent-panel">
              <h2>Recent Commands & Events</h2>
              <div
                v-if="
                  selectedGuild.recent.commandUsages.length === 0 &&
                  selectedGuild.recent.events.length === 0
                "
                class="empty-state"
              >
                No guild command or event records captured.
              </div>
              <div v-else class="recent-list">
                <article
                  v-for="command in selectedGuild.recent.commandUsages"
                  :key="`command-${command.id}`"
                  class="recent-row"
                >
                  <strong>/{{ command.commandName }}</strong>
                  <span
                    >{{ command.status
                    }}{{ command.errorCode ? ` · ${command.errorCode}` : "" }}</span
                  >
                  <small>{{ formatDateTime(command.occurredAt) }}</small>
                </article>
                <article
                  v-for="event in selectedGuild.recent.events"
                  :key="`event-${event.id}`"
                  class="recent-row"
                >
                  <strong>{{ event.eventType }}</strong>
                  <span
                    >{{ event.status
                    }}{{ event.errorCode ? ` · ${event.errorCode}` : "" }}</span
                  >
                  <small>{{ formatDateTime(event.occurredAt) }}</small>
                </article>
              </div>
            </article>
          </section>
        </template>
      </section>

      <section v-else-if="activeSection === 'Automation'" class="section-grid">
        <article class="panel wide">
          <apexchart
            height="330"
            type="bar"
            :options="automationOptions"
            :series="automationSeries"
          />
        </article>
        <div class="stat-grid">
          <article class="stat-card">
            <span>Automation Runs 24h</span>
            <strong>{{ formatNumber(totals?.automationRuns24h ?? 0) }}</strong>
            <small
              >{{
                formatNumber(totals?.automationFailures24h ?? 0)
              }}
              partial/failed</small
            >
          </article>
          <article class="stat-card">
            <span>Queued Jobs</span>
            <strong>{{
              formatNumber(dashboard?.queue.guildAutomation?.jobsByStatus?.queued ?? 0)
            }}</strong>
            <small>Guild automation queue</small>
          </article>
        </div>
      </section>

      <section v-else-if="activeSection === 'Log'" class="section-grid">
        <article class="panel wide log-panel">
          <div class="panel-heading">
            <div>
              <h2>Console Log</h2>
              <p>
                Live process output, newest first. The bot shows the latest
                {{ formatNumber(runtimeLogMeta?.maxLines ?? 10000) }} lines here and
                stores console logs for
                {{ formatNumber(runtimeLogMeta?.retentionDays ?? 30) }} days.
              </p>
            </div>
            <span class="status-chip healthy">
              {{ isLogLoading ? "Refreshing" : "Live" }}
            </span>
          </div>

          <div class="log-toolbar">
            <span>
              Showing {{ formatNumber(runtimeLogs.length) }} of
              {{ formatNumber(runtimeLogMeta?.totalBuffered ?? runtimeLogs.length) }}
              buffered line(s)
            </span>
            <button
              class="inline-button"
              type="button"
              :disabled="isLogLoading"
              @click="refreshLogs"
            >
              {{ isLogLoading ? "Refreshing..." : "Refresh now" }}
            </button>
          </div>

          <p v-if="logErrorMessage" class="error-message" role="alert">
            {{ logErrorMessage }}
          </p>

          <div v-if="runtimeLogs.length === 0" class="empty-state">
            No console output has been captured yet.
          </div>

          <div v-else class="log-stream" aria-live="polite">
            <article
              v-for="entry in runtimeLogs"
              :key="entry.id"
              class="log-row"
              :class="entry.level"
            >
              <time :datetime="entry.timestamp">{{
                formatLogTime(entry.timestamp)
              }}</time>
              <span>{{ entry.level }}</span>
              <code>{{ entry.message }}</code>
            </article>
          </div>
        </article>
      </section>

      <section v-else class="section-grid two-column">
        <article class="panel info-panel">
          <h2>Failure Snapshot</h2>
          <dl>
            <div>
              <dt>Failures 24h</dt>
              <dd>{{ formatNumber(totals?.failures24h ?? 0) }}</dd>
            </div>
            <div>
              <dt>Event Failures</dt>
              <dd>{{ formatNumber(totals?.eventsFailed24h ?? 0) }}</dd>
            </div>
            <div>
              <dt>Command Failures</dt>
              <dd>{{ formatNumber(totals?.commandsFailed24h ?? 0) }}</dd>
            </div>
            <div>
              <dt>DM Failures</dt>
              <dd>{{ formatNumber(totals?.dmsFailed24h ?? 0) }}</dd>
            </div>
          </dl>
        </article>
        <article class="panel info-panel">
          <h2>Current Health Impact</h2>
          <div v-if="healthIssues.length === 0" class="empty-state">
            No active degraded or unhealthy checks.
          </div>
          <div v-else class="health-impact-list">
            <article
              v-for="issue in healthIssues"
              :key="`failure-health-${issue.check}`"
              class="mini-issue"
            >
              <span class="status-chip" :class="issue.status">
                {{ capitalize(issue.status) }}
              </span>
              <strong>{{ formatCheckName(issue.check) }}</strong>
              <p>{{ issue.reason }}</p>
            </article>
          </div>
        </article>

        <article class="panel wide">
          <div class="panel-heading">
            <div>
              <h2>Recent Failure Records</h2>
              <p>Exact stored failures from the bot failure log.</p>
            </div>
            <span class="status-chip">{{ formatNumber(recentFailures.length) }}</span>
          </div>

          <div v-if="recentFailures.length === 0" class="empty-state">
            No failure records captured yet.
          </div>
          <div v-else class="failure-list">
            <article
              v-for="failure in recentFailures"
              :key="failure.id"
              class="failure-card"
              :class="[failure.severity, { ignored: !failure.affectsHealth }]"
            >
              <div class="failure-header">
                <div>
                  <strong>{{ formatFailureTitle(failure) }}</strong>
                  <p>{{ failure.message }}</p>
                </div>
                <span
                  class="status-chip"
                  :class="failure.affectsHealth ? failure.severity : 'ignored'"
                >
                  {{ failure.affectsHealth ? capitalize(failure.severity) : "Ignored" }}
                </span>
              </div>
              <dl class="compact-details">
                <div>
                  <dt>When</dt>
                  <dd>{{ formatDateTime(failure.occurredAt) }}</dd>
                </div>
                <div>
                  <dt>Error Code</dt>
                  <dd>{{ failure.errorCode ?? "none" }}</dd>
                </div>
                <div>
                  <dt>Event</dt>
                  <dd>{{ failure.eventType ?? "none" }}</dd>
                </div>
                <div>
                  <dt>Guild</dt>
                  <dd>{{ failure.discordGuildId ?? "none" }}</dd>
                </div>
                <div>
                  <dt>User</dt>
                  <dd>{{ failure.discordUserId ?? "none" }}</dd>
                </div>
                <div>
                  <dt>Run</dt>
                  <dd>{{ failure.runId ?? "none" }}</dd>
                </div>
              </dl>
              <details class="json-details">
                <summary>Failure details</summary>
                <pre>{{ formatDetails(failure.details) }}</pre>
              </details>
            </article>
          </div>
        </article>
      </section>
    </section>
  </main>
</template>
