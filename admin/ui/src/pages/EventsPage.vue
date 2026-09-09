<script setup lang="ts">
import { useDashboardContext } from "../composables/dashboardContext.js";
import ApexChart from "vue3-apexcharts";
const { eventOptions, notificationOptions, eventSeries, notificationSeries } =
  useDashboardContext();
</script>

<template>
  <section class="section-grid two-column">
    <article class="panel">
      <ApexChart height="330" type="bar" :options="eventOptions" :series="eventSeries" />
    </article>
    <article class="panel">
      <ApexChart
        height="330"
        type="bar"
        :options="notificationOptions"
        :series="notificationSeries"
      />
    </article>
  </section>
</template>
