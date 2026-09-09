import { formatDiscordDateTime } from "../../lib/discordTimestamps.js";
import {
  getLocalizedLabel,
  getRecordNumberValue,
  getRecordStringValue,
  getRecordUnknownValue,
  getRecordValue,
  getStringValue,
  isRecord,
  isString,
} from "./values.js";

export type RunCompletionDetails = {
  completedAt?: string;
  entryMode?: string;
  furthestProgress?: string;
  milestones: RunMilestoneDetails[];
  progressLinkUrl?: string;
  progressNotes?: string;
  progressRecordedAt?: string;
};

type RunMilestoneDetails = {
  details: string[];
  label: string;
};

export function buildRunCompletionFields(
  completion: RunCompletionDetails | undefined,
): string[] {
  if (!completion) {
    return [];
  }

  const lines = [
    completion.completedAt ? `Completed at: ${completion.completedAt}` : undefined,
    completion.progressRecordedAt &&
    completion.progressRecordedAt !== completion.completedAt
      ? `Progress recorded: ${completion.progressRecordedAt}`
      : undefined,
    completion.furthestProgress ? `Progress: ${completion.furthestProgress}` : undefined,
    completion.entryMode ? `Entry mode: ${completion.entryMode}` : undefined,
    completion.progressNotes ? `Notes: ${completion.progressNotes}` : undefined,
    completion.progressLinkUrl
      ? `Progress link: ${completion.progressLinkUrl}`
      : undefined,
  ].filter(isString);

  if (completion.milestones.length > 0) {
    lines.push("Milestones:");
    lines.push(...completion.milestones.map(formatRunMilestone));
  }

  return lines;
}

function formatRunMilestone(milestone: RunMilestoneDetails): string {
  return milestone.details.length > 0
    ? `- ${milestone.label}: ${milestone.details.join(", ")}`
    : `- ${milestone.label}`;
}

export function getRunCompletionDetails(
  payload: unknown,
): RunCompletionDetails | undefined {
  const completion = getRecordValue(payload, "completion");

  if (!completion) {
    return undefined;
  }

  const completedAt = formatDiscordDateTime(
    getRecordStringValue(completion, "completed_at"),
  );
  const progressRecordedAt = formatDiscordDateTime(
    getRecordStringValue(completion, "progress_recorded_at"),
  );
  const entryMode = getStringValue(
    getRecordUnknownValue(completion, "progress_entry_mode"),
  );
  const progressLinkUrl = getRecordStringValue(completion, "progress_link_url");
  const progressNotes = getRecordStringValue(completion, "progress_notes");
  const furthestProgress = formatFurthestProgress(completion);
  const milestones = getRunMilestones(completion);
  const details: RunCompletionDetails = {
    milestones,
  };

  if (completedAt) {
    details.completedAt = completedAt;
  }

  if (progressRecordedAt) {
    details.progressRecordedAt = progressRecordedAt;
  }

  if (entryMode) {
    details.entryMode = entryMode;
  }

  if (progressLinkUrl) {
    details.progressLinkUrl = progressLinkUrl;
  }

  if (progressNotes) {
    details.progressNotes = progressNotes;
  }

  if (furthestProgress) {
    details.furthestProgress = furthestProgress;
  }

  return hasRunCompletionDetails(details) ? details : undefined;
}

function hasRunCompletionDetails(details: RunCompletionDetails): boolean {
  return Boolean(
    details.completedAt ??
    details.entryMode ??
    details.furthestProgress ??
    (details.milestones.length > 0 ? "milestones" : undefined) ??
    details.progressLinkUrl ??
    details.progressNotes ??
    details.progressRecordedAt,
  );
}

function formatFurthestProgress(completion: Record<string, unknown>): string | undefined {
  const label =
    getRecordStringValue(completion, "furthest_progress_label") ??
    getStringValue(getRecordUnknownValue(completion, "furthest_progress_key"));
  const percent = getRecordNumberValue(completion, "furthest_progress_percent");
  const formattedPercent = formatPercent(percent);

  if (label && formattedPercent) {
    return `${label} (${formattedPercent})`;
  }

  return label ?? formattedPercent;
}

function getRunMilestones(completion: Record<string, unknown>): RunMilestoneDetails[] {
  const milestones = getRecordUnknownValue(completion, "milestones");

  if (!Array.isArray(milestones)) {
    return [];
  }

  return milestones.flatMap((milestone) => {
    if (!isRecord(milestone)) {
      return [];
    }

    const label =
      getLocalizedLabel(getRecordUnknownValue(milestone, "milestone_label")) ??
      getStringValue(getRecordUnknownValue(milestone, "milestone_key"));

    if (!label) {
      return [];
    }

    const details = getRunMilestoneDetails(milestone);

    return [{ details, label }];
  });
}

function getRunMilestoneDetails(milestone: Record<string, unknown>): string[] {
  const details: string[] = [];
  const bestProgress = formatPercent(
    getRecordNumberValue(milestone, "best_progress_percent"),
  );
  const kills = getRecordNumberValue(milestone, "kills");
  const notes = getRecordStringValue(milestone, "notes");

  if (bestProgress) {
    details.push(`${bestProgress} best`);
  }

  if (kills !== undefined) {
    details.push(`${formatNumber(kills)} ${kills === 1 ? "kill" : "kills"}`);
  }

  if (notes) {
    details.push(`notes: ${notes}`);
  }

  return details;
}

function formatPercent(value: number | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return `${formatNumber(value)}%`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/u, "").replace(/\.$/u, "");
}
