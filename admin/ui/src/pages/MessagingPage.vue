<script setup lang="ts">
import { useDashboardContext } from "../composables/dashboardContext.js";
import { formatNumber } from "../lib/formatters.js";
import ApexChart from "vue3-apexcharts";
const { totals, donutOptions, dmStatusSeries } = useDashboardContext();
</script>

<template>
  <section class="section-grid two-column">
    <article class="panel">
      <ApexChart
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
</template>
