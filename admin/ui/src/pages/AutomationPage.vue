<script setup lang="ts">
import { useDashboardContext } from "../composables/dashboardContext.js";
import { formatNumber } from "../lib/formatters.js";
import ApexChart from "vue3-apexcharts";
const { dashboard, totals, automationSeries, automationOptions } = useDashboardContext();
</script>

<template>
  <section class="section-grid">
    <article class="panel wide">
      <ApexChart
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
          >{{ formatNumber(totals?.automationFailures24h ?? 0) }} partial/failed</small
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
</template>
