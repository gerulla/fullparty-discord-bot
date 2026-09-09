import type { ApexOptions } from "apexcharts";
import type {
  AdminLabeledCount as LabeledCount,
  AdminMetricBucket as MetricBucket,
} from "../../../src/shared/contracts.js";
import { capitalize } from "./formatters.js";
const chartColors = ["#a78bfa", "#38bdf8", "#22c55e", "#f59e0b", "#ef4444", "#f472b6"];

export function createSeries(
  name: string,
  key: keyof Omit<MetricBucket, "label">,
  buckets: MetricBucket[],
) {
  return {
    data: buckets.map((bucket) => bucket[key]),
    name,
  };
}

export function createCartesianOptions(categories: string[], title: string): ApexOptions {
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
      markers: { size: 4 },
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

export function createDailyTotalsOptions(
  categories: string[],
  title: string,
): ApexOptions {
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
      markers: { size: 4 },
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

export function createDonutOptions(items: LabeledCount[]): ApexOptions {
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

export function createHorizontalBarOptions(items: LabeledCount[]): ApexOptions {
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
