import { onBeforeUnmount, ref } from "vue";
import type {
  RuntimeLogEntry,
  RuntimeLogsResponse,
} from "../../../src/shared/contracts.js";
import { AdminApiError, type AdminApiClient } from "../api/adminApiClient.js";

export function useRuntimeLogs(
  api: AdminApiClient,
  getToken: () => string,
  onUnauthorized: () => void,
) {
  const runtimeLogs = ref<RuntimeLogEntry[]>([]);
  const runtimeLogMeta = ref<RuntimeLogsResponse["meta"] | null>(null);
  const isLogLoading = ref(false);
  const logErrorMessage = ref("");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active = false;
  let generation = 0;
  let request: AbortController | undefined;

  async function refreshLogs(): Promise<void> {
    if (request || !getToken()) return;
    const controller = new AbortController();
    request = controller;
    isLogLoading.value = true;
    logErrorMessage.value = "";
    try {
      const response = await api.getLogs(getToken(), controller.signal);
      if (controller.signal.aborted) return;
      runtimeLogs.value = response.data;
      runtimeLogMeta.value = response.meta;
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof AdminApiError && error.status === 401) onUnauthorized();
      logErrorMessage.value =
        error instanceof Error ? error.message : "Unable to refresh logs.";
    } finally {
      if (request === controller) {
        request = undefined;
        isLogLoading.value = false;
      }
    }
  }

  async function poll(currentGeneration: number): Promise<void> {
    await refreshLogs();
    if (active && currentGeneration === generation)
      timer = setTimeout(() => {
        void poll(currentGeneration);
      }, 2_000);
  }

  function stop(): void {
    active = false;
    generation++;
    clearTimeout(timer);
    timer = undefined;
    request?.abort();
    request = undefined;
    isLogLoading.value = false;
  }

  function setActive(value: boolean): void {
    if (!value) {
      stop();
      return;
    }
    if (!active) {
      active = true;
      void poll(generation);
    }
  }

  function clear(): void {
    stop();
    runtimeLogs.value = [];
    runtimeLogMeta.value = null;
    logErrorMessage.value = "";
  }

  onBeforeUnmount(stop);
  return {
    runtimeLogs,
    runtimeLogMeta,
    isLogLoading,
    logErrorMessage,
    refreshLogs,
    setActive,
    clear,
  };
}
