import { inject, provide, type InjectionKey } from "vue";
import type { useDashboard } from "./useDashboard.js";

type DashboardState = ReturnType<typeof useDashboard>;
const dashboardKey: InjectionKey<DashboardState> = Symbol("dashboard");

export function provideDashboard(state: DashboardState): void {
  provide(dashboardKey, state);
}

export function useDashboardContext(): DashboardState {
  const state = inject(dashboardKey);
  if (!state) throw new Error("Dashboard context is unavailable.");
  return state;
}
