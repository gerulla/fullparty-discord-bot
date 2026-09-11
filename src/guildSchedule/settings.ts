import { z } from "zod";

export const scheduleIntervalDaysSchema = z.number().int().min(1).max(7);
export const scheduleIntervals = [1, 2, 3, 4, 5, 6, 7] as const;
export const dayMs = 86_400_000;

export function formatScheduleInterval(days: number): string {
  return days === 1 ? "Daily" : days === 7 ? "Weekly" : `Every ${String(days)} days`;
}
