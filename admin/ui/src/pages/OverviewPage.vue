<script setup lang="ts">
import { useDashboardContext } from "../composables/dashboardContext.js";
import {
  formatDateTime,
  formatDetails,
  formatCheckName,
  capitalize,
} from "../lib/formatters.js";
import ApexChart from "vue3-apexcharts";
const {
  healthIssues,
  healthTone,
  healthSubtitle,
  statCards,
  activitySeries,
  hourlySeries,
  activityChartOptions,
  hourlyChartOptions,
} = useDashboardContext();
</script>

<template>
  <section class="section-grid">
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
        <span class="status-chip" :class="healthTone">{{ capitalize(healthTone) }}</span>
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
      <ApexChart
        height="330"
        type="bar"
        :options="activityChartOptions"
        :series="activitySeries"
      />
    </article>

    <article class="panel wide">
      <ApexChart
        height="300"
        type="line"
        :options="hourlyChartOptions"
        :series="hourlySeries"
      />
    </article>
  </section>
</template>
