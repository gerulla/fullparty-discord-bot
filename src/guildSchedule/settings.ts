import { z } from "zod";

export const scheduleModeSchema = z.enum(["disabled", "timed_refresh", "run_detection"]);
export type ScheduleMode = z.infer<typeof scheduleModeSchema>;

export const scheduleFormatSchema = z.enum(["plain", "expanded", "interactive"]);
export type ScheduleFormat = z.infer<typeof scheduleFormatSchema>;
export const schedulePostFormatSchema = scheduleFormatSchema.exclude(["interactive"]);
export type SchedulePostFormat = z.infer<typeof schedulePostFormatSchema>;

export function getSchedulePostFormat(format?: ScheduleFormat): SchedulePostFormat {
  return format === "expanded" ? "expanded" : "plain";
}

export function formatScheduleFormat(format: ScheduleFormat): string {
  return { plain: "Plain", expanded: "Expanded", interactive: "Interactive" }[format];
}

export function getScheduleMode(settings: {
  scheduleMode?: ScheduleMode;
  scheduleRefreshEnabled?: boolean;
}): ScheduleMode {
  return (
    settings.scheduleMode ??
    (settings.scheduleRefreshEnabled ? "timed_refresh" : "disabled")
  );
}

export const scheduleIntervalDaysSchema = z.number().int().min(1).max(7);
export const scheduleIntervals = [1, 2, 3, 4, 5, 6, 7] as const;
export const dayMs = 86_400_000;

export function formatScheduleInterval(days: number): string {
  return days === 1 ? "Daily" : days === 7 ? "Weekly" : `Every ${String(days)} days`;
}
