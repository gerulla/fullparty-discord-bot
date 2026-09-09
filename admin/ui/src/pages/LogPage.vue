<script setup lang="ts">
import { useDashboardContext } from "../composables/dashboardContext.js";
import { formatNumber, formatLogTime } from "../lib/formatters.js";
const { runtimeLogs, runtimeLogMeta, isLogLoading, logErrorMessage, refreshLogs } =
  useDashboardContext();
</script>

<template>
  <section class="section-grid">
    <article class="panel wide log-panel">
      <div class="panel-heading">
        <div>
          <h2>Console Log</h2>
          <p>
            Live process output, newest first. The bot shows the latest
            {{ formatNumber(runtimeLogMeta?.maxLines ?? 10000) }} lines here and stores
            console logs for {{ formatNumber(runtimeLogMeta?.retentionDays ?? 30) }} days.
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
          <time :datetime="entry.timestamp">{{ formatLogTime(entry.timestamp) }}</time>
          <span>{{ entry.level }}</span>
          <code>{{ entry.message }}</code>
        </article>
      </div>
    </article>
  </section>
</template>
