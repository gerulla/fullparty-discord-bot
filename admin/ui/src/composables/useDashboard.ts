import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { DashboardPayload } from "../../../src/shared/contracts.js";
import { AdminApiClient, AdminApiError } from "../api/adminApiClient.js";
import { formatNumber } from "../lib/formatters.js";
import { useDashboardMetrics } from "./useDashboardMetrics.js";
import { useRuntimeLogs } from "./useRuntimeLogs.js";

const storageKey = "fullparty.adminApiToken";
const sections = [
  "Overview",
  "Events",
  "Messaging",
  "Guilds",
  "Automation",
  "Failures",
  "Log",
] as const;

export function useDashboard(api = new AdminApiClient()) {
  const activeSection = ref<(typeof sections)[number]>("Overview");
  const token = ref("");
  const authenticatedToken = ref("");
  const isLoading = ref(false);
  const errorMessage = ref("");
  const dashboard = ref<DashboardPayload | null>(null);
  const selectedGuildId = ref("");
  const isMemberCacheRefreshing = ref(false);
  const memberCacheRefreshMessage = ref("");
  const metrics = useDashboardMetrics(dashboard, selectedGuildId);
  const logs = useRuntimeLogs(api, () => authenticatedToken.value, logout);
  let session = new AbortController();

  function setDashboard(value: DashboardPayload): void {
    dashboard.value = value;
    const guilds = value.guilds.details;
    if (!guilds.some((entry) => entry.guild.discordGuildId === selectedGuildId.value)) {
      selectedGuildId.value =
        (guilds.find((entry) => entry.guild.linked) ?? guilds[0])?.guild.discordGuildId ??
        "";
    }
  }

  function handleError(error: unknown): void {
    if (error instanceof AdminApiError && error.status === 401) logout();
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to load dashboard.";
  }

  async function login(): Promise<void> {
    if (isLoading.value) return;
    const value = token.value.trim();
    if (!value) {
      errorMessage.value = "Enter your admin API token.";
      return;
    }
    isLoading.value = true;
    errorMessage.value = "";
    const signal = session.signal;
    try {
      const response = await api.getDashboard(value, signal);
      if (signal.aborted) return;
      sessionStorage.setItem(storageKey, value);
      authenticatedToken.value = value;
      setDashboard(response.data);
    } catch (error) {
      if (!signal.aborted) {
        sessionStorage.removeItem(storageKey);
        handleError(error);
      }
    } finally {
      if (!signal.aborted) isLoading.value = false;
    }
  }

  async function refreshDashboard(): Promise<void> {
    if (isLoading.value) return;
    if (!authenticatedToken.value) {
      logout();
      return;
    }
    isLoading.value = true;
    errorMessage.value = "";
    const signal = session.signal;
    try {
      const response = await api.getDashboard(authenticatedToken.value, signal);
      if (!signal.aborted) setDashboard(response.data);
    } catch (error) {
      if (!signal.aborted) handleError(error);
    } finally {
      if (!signal.aborted) isLoading.value = false;
    }
  }

  async function refreshGuildMemberCache(): Promise<void> {
    if (isMemberCacheRefreshing.value) return;
    if (!authenticatedToken.value) {
      logout();
      return;
    }
    isMemberCacheRefreshing.value = true;
    memberCacheRefreshMessage.value = "";
    const signal = session.signal;
    try {
      const { data } = await api.refreshMemberCache(authenticatedToken.value, signal);
      if (signal.aborted) return;
      const obsolete =
        data.obsoleteUnavailableGuildCount ?? data.deletedUnavailableGuildCount;
      memberCacheRefreshMessage.value = [
        `Queued ${formatNumber(data.queuedGuildCount)} linked guild refresh job(s).`,
        data.skippedGuildCount > 0
          ? `${formatNumber(data.skippedGuildCount)} already queued/running.`
          : "",
        obsolete > 0
          ? `${formatNumber(obsolete)} unavailable cache row(s) marked obsolete.`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      await refreshDashboard();
    } catch (error) {
      if (!signal.aborted) {
        handleError(error);
        memberCacheRefreshMessage.value = errorMessage.value;
      }
    } finally {
      if (!signal.aborted) isMemberCacheRefreshing.value = false;
    }
  }

  function logout(): void {
    session.abort();
    session = new AbortController();
    logs.clear();
    authenticatedToken.value = "";
    token.value = "";
    dashboard.value = null;
    selectedGuildId.value = "";
    isLoading.value = false;
    isMemberCacheRefreshing.value = false;
    errorMessage.value = "";
    memberCacheRefreshMessage.value = "";
    sessionStorage.removeItem(storageKey);
  }

  onMounted(() => {
    const savedToken = sessionStorage.getItem(storageKey);
    if (savedToken) {
      token.value = savedToken;
      void login();
    }
  });
  onBeforeUnmount(() => {
    session.abort();
  });
  watch([activeSection, metrics.isLoggedIn], () => {
    logs.setActive(activeSection.value === "Log" && metrics.isLoggedIn.value);
  });

  return {
    sections,
    activeSection,
    token,
    isLoading,
    errorMessage,
    dashboard,
    selectedGuildId,
    isMemberCacheRefreshing,
    memberCacheRefreshMessage,
    ...metrics,
    ...logs,
    login,
    logout,
    refreshDashboard,
    refreshGuildMemberCache,
  };
}
