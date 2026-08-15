import { formatDiscordDateTime } from "../lib/discordTimestamps.js";
import { humanizeIdentifier } from "./notificationText.js";
import type { NotificationCopy, NotificationDeliveryData } from "./types.js";

type NotificationCopyFormatter = (
  data: NotificationDeliveryData,
  copy: NotificationCopy,
) => NotificationCopy;

const formatterByType: Record<string, NotificationCopyFormatter> = {
  "applications.cancelled": (data, copy) =>
    formatApplicationNotification(
      data,
      copy,
      "Your application was cancelled",
      "Application cancelled",
      ["character", "status", "reason"],
    ),
  "applications.declined": (data, copy) =>
    formatApplicationNotification(
      data,
      copy,
      "Your application was declined",
      "Application declined",
      ["character", "status", "reason"],
    ),
  "applications.new_for_review": (data, copy) =>
    formatApplicationNotification(
      data,
      copy,
      "A new application needs review",
      "Application needs review",
      ["character", "status", "reason", "count"],
    ),
  "applications.submitted": (data, copy) =>
    formatApplicationNotification(
      data,
      copy,
      "Your application was submitted",
      "Application submitted",
      ["character", "status", "reason"],
    ),
  "applications.updated": (data, copy) =>
    formatApplicationNotification(
      data,
      copy,
      "An application was updated",
      "Application updated",
      ["character", "status", "reason"],
    ),
  "applications.withdrawn": (data, copy) =>
    formatApplicationNotification(
      data,
      copy,
      "An application was withdrawn",
      "Application withdrawn",
      ["character", "status", "reason"],
    ),
  "assignments.assigned": (data, copy) => {
    const details = getAssignmentDetails(data);

    if (!hasAssignmentDetails(details)) {
      return copy;
    }

    const summary = buildAssignmentSummary("You were assigned", details, "to the roster");
    const fields = buildAssignmentFields(details, [
      "startsAt",
      "character",
      "extraFields",
      "slot",
    ]);

    return {
      ...copy,
      description: joinDescriptionParts(summary, fields),
      title: "Roster assignment updated",
    };
  },
  "assignments.on_bench": (data, copy) => {
    const details = getAssignmentDetails(data);

    if (!hasAssignmentDetails(details)) {
      return copy;
    }

    const summary = buildAssignmentSummary("You were moved", details, "to the bench");
    const fields = buildAssignmentFields(details, ["character", "extraFields"]);

    return {
      ...copy,
      description: joinDescriptionParts(summary, fields),
      title: "Bench assignment updated",
    };
  },
  "assignments.returned_to_queue": (data, copy) => {
    const details = getAssignmentDetails(data);

    if (!hasAssignmentDetails(details)) {
      return copy;
    }

    const summary = buildAssignmentSummary("You were returned", details, "to the queue");
    const fields = buildAssignmentFields(details, ["character", "extraFields"]);

    return {
      ...copy,
      description: joinDescriptionParts(summary, fields),
      title: "Returned to queue",
    };
  },
  "assignments.marked_missing": (data, copy) => {
    const details = getAssignmentDetails(data);

    if (!hasAssignmentDetails(details)) {
      return copy;
    }

    const summary = buildAssignmentSummary("You were marked missing", details);
    const fields = buildAssignmentFields(details, [
      "character",
      "extraFields",
      "slot",
      "attendanceStatus",
    ]);

    return {
      ...copy,
      description: joinDescriptionParts(summary, fields),
      title: "Marked missing",
    };
  },
  "assignments.missing_restored": (data, copy) => {
    const details = getAssignmentDetails(data);

    if (!hasAssignmentDetails(details)) {
      return copy;
    }

    const summary = buildAssignmentSummary("You are no longer marked missing", details);
    const fields = buildAssignmentFields(details, [
      "character",
      "extraFields",
      "slot",
      "attendanceStatus",
    ]);

    return {
      ...copy,
      description: joinDescriptionParts(summary, fields),
      title: "Missing status restored",
    };
  },
  "assignments.roster_published_assigned": (data, copy) => {
    const details = getAssignmentDetails(data);
    const summary = buildAssignmentSummary(
      "Your roster assignment",
      details,
      "was published",
    );
    const fields = buildAssignmentFields(details, [
      "startsAt",
      "character",
      "extraFields",
      "slot",
    ]);

    return {
      ...copy,
      description: joinDescriptionParts(summary, fields),
      title: "Roster published",
    };
  },
  "assignments.roster_published_bench": (data, copy) => {
    const details = getAssignmentDetails(data);
    const summary = buildAssignmentSummary(
      "Your bench assignment",
      details,
      "was published",
    );
    const fields = buildAssignmentFields(details, [
      "startsAt",
      "character",
      "extraFields",
    ]);

    return {
      ...copy,
      description: joinDescriptionParts(summary, fields),
      title: "Roster published",
    };
  },
  "assignments.designation_assigned": (data, copy) => {
    const details = getAssignmentDetails(data);
    const designation = getDesignationDisplayName(data);
    const summary = buildAssignmentSummary(
      designation
        ? `${designation} was assigned to you`
        : "A designation was assigned to you",
      details,
    );
    const fields = buildAssignmentFields(details, ["character", "extraFields", "slot"]);

    return {
      ...copy,
      description: joinDescriptionParts(summary, fields),
      title: designation ? `${designation} assigned` : "Designation assigned",
    };
  },
  "assignments.designation_removed": (data, copy) => {
    const details = getAssignmentDetails(data);
    const designation = getDesignationDisplayName(data);
    const summary = buildAssignmentSummary(
      designation
        ? `${designation} was removed from you`
        : "A designation was removed from you",
      details,
    );
    const fields = buildAssignmentFields(details, ["character", "extraFields", "slot"]);

    return {
      ...copy,
      description: joinDescriptionParts(summary, fields),
      title: designation ? `${designation} removed` : "Designation removed",
    };
  },
  "characters.added": (data, copy) => {
    const character = getCharacterDisplayName(data);
    const method = getStringValue(data.notification.params.method);

    if (!character) {
      return copy;
    }

    return {
      ...copy,
      description: method
        ? `${character} was added to your FullParty account via ${method}.`
        : `${character} was added to your FullParty account.`,
      title: "Character added",
    };
  },
  "characters.unclaimed": (data, copy) => {
    const character = getCharacterDisplayName(data);

    if (!character) {
      return copy;
    }

    return {
      ...copy,
      description: `${character} was unclaimed from your FullParty account.`,
      title: "Character unclaimed",
    };
  },
  "runs.cancelled": (data, copy) => {
    const details = getRunDetails(data);

    if (!hasRunDetails(details)) {
      return copy;
    }

    return {
      ...copy,
      description: joinDescriptionParts(
        buildRunSummary(details, "was cancelled"),
        buildRunFields(details),
      ),
      title: "Run cancelled",
    };
  },
  "runs.completed": (data, copy) => {
    const details = getRunDetails(data);

    if (!hasRunDetails(details)) {
      return copy;
    }

    return {
      ...copy,
      description: joinDescriptionParts(
        buildRunSummary(details, "was completed"),
        buildRunFields(details),
      ),
      title: "Run completed",
    };
  },
  "runs.starting_soon": (data, copy) => {
    const details = getRunDetails(data);

    if (!hasRunDetails(details)) {
      return copy;
    }

    return {
      ...copy,
      description: joinDescriptionParts(
        buildRunSummary(details, "starts soon"),
        buildRunFields(details),
      ),
      title: "Run starting soon",
    };
  },
  "runs.starting_now": (data, copy) => {
    const details = getRunDetails(data);

    if (!hasRunDetails(details)) {
      return copy;
    }

    return {
      ...copy,
      description: joinDescriptionParts(
        buildRunSummary(details, "is starting now"),
        buildRunFields(details),
      ),
      title: "Run starting now",
    };
  },
  "runs.party_finder_published": (data, copy) => {
    const details = getPartyFinderDetails(data);

    if (!hasPartyFinderDetails(details)) {
      return copy;
    }

    return {
      ...copy,
      description: joinDescriptionParts(
        buildPartyFinderSummary(details),
        buildPartyFinderFields(details),
      ),
      title: "Party Finder posted",
    };
  },
  "user.social_account.linked": (data, copy) => {
    const provider = getSocialAccountProvider(data);

    if (!provider) {
      return copy;
    }

    return {
      ...copy,
      description: `${provider} was linked to your FullParty account.`,
      title: `${provider} account linked`,
    };
  },
  "user.social_account.unlinked": (data, copy) => {
    const provider = getSocialAccountProvider(data);

    if (!provider) {
      return copy;
    }

    return {
      ...copy,
      description: `${provider} was removed from your FullParty account.`,
      title: `${provider} account removed`,
    };
  },
};

type AssignmentDetails = {
  activity?: string;
  attendanceStatus?: string;
  character?: string;
  extraFields: AssignmentDetailField[];
  group?: string;
  slot?: string;
  startsAt?: string;
};

type AssignmentDetailField = {
  label: string;
  value: string;
};

type ApplicationDetails = {
  activity?: string;
  character?: string;
  count?: number;
  group?: string;
  reason?: string;
  startsAt?: string;
  status?: string;
};

type RunDetails = {
  activity?: string;
  completion?: RunCompletionDetails;
  group?: string;
  startsAt?: string;
  status?: string;
};

type PartyFinderDetails = {
  activity?: string;
  character?: string;
  group?: string;
  password?: string;
  publishedAt?: string;
  startsAt?: string;
  status?: string;
  world?: string;
};

type RunCompletionDetails = {
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

export function formatNotificationCopy(
  data: NotificationDeliveryData,
  copy: NotificationCopy,
): NotificationCopy {
  return formatterByType[data.notification.type]?.(data, copy) ?? copy;
}

function formatApplicationNotification(
  data: NotificationDeliveryData,
  copy: NotificationCopy,
  subject: string,
  title: string,
  fields: ApplicationFieldKey[],
): NotificationCopy {
  const details = getApplicationDetails(data);

  if (!hasApplicationDetails(details)) {
    return copy;
  }

  return {
    ...copy,
    description: joinDescriptionParts(
      buildApplicationSummary(subject, details),
      buildApplicationFields(details, addStartsAtField(details, fields)),
    ),
    title,
  };
}

function getApplicationDetails(data: NotificationDeliveryData): ApplicationDetails {
  const details: ApplicationDetails = {};
  const activity =
    getDisplayStringValue(data.notification.params.activity) ??
    getPayloadDisplayStringValue(data.notification.payload, "activity_title");
  const character =
    getDisplayStringValue(data.notification.params.character) ??
    getPayloadDisplayStringValue(data.notification.payload, "character_name");
  const count = getNumberValue(data.notification.params.count);
  const group =
    getDisplayStringValue(data.notification.params.group) ??
    getPayloadDisplayStringValue(data.notification.payload, "group_slug");
  const reason =
    getDisplayStringValue(data.notification.params.reason) ??
    getPayloadDisplayStringValue(data.notification.payload, "review_reason");
  const status = getPayloadStringValue(data.notification.payload, "status");
  const startsAt = getNotificationStartsAt(data);

  if (activity) {
    details.activity = activity;
  }

  if (character) {
    details.character = character;
  }

  if (count !== undefined) {
    details.count = count;
  }

  if (group) {
    details.group = group;
  }

  if (reason) {
    details.reason = reason;
  }

  if (status) {
    details.status = status;
  }

  if (startsAt) {
    details.startsAt = startsAt;
  }

  return details;
}

function hasApplicationDetails(details: ApplicationDetails): boolean {
  return Boolean(
    details.activity ??
    details.character ??
    (details.count !== undefined ? "count" : undefined) ??
    details.group ??
    details.reason ??
    details.startsAt ??
    details.status,
  );
}

function buildApplicationSummary(subject: string, details: ApplicationDetails): string {
  const activity = details.activity ? ` for ${details.activity}` : "";
  const group = details.group ? ` in ${details.group}` : "";

  return `${subject}${activity}${group}.`;
}

function buildApplicationFields(
  details: ApplicationDetails,
  fields: ApplicationFieldKey[],
): string | undefined {
  const lines = fields.flatMap((field) => {
    const value = details[field];

    if (value === undefined) {
      return [];
    }

    return [`${applicationFieldLabels[field]}: ${String(value)}`];
  });

  return lines.length > 0 ? lines.join("\n") : undefined;
}

function addStartsAtField(
  details: ApplicationDetails,
  fields: ApplicationFieldKey[],
): ApplicationFieldKey[] {
  return details.startsAt && !fields.includes("startsAt")
    ? ["startsAt", ...fields]
    : fields;
}

type ApplicationFieldKey = "character" | "count" | "reason" | "startsAt" | "status";

const applicationFieldLabels: Record<ApplicationFieldKey, string> = {
  character: "Character",
  count: "Applications waiting",
  reason: "Reason",
  startsAt: "Scheduled start",
  status: "Status",
};

function getAssignmentDetails(data: NotificationDeliveryData): AssignmentDetails {
  const slot = getSlotDisplayName(data);
  const details: AssignmentDetails = {
    extraFields: getAssignmentExtraFields(data),
  };
  const activity =
    getDisplayStringValue(data.notification.params.activity) ??
    getPayloadDisplayStringValue(data.notification.payload, "activity_title");
  const character =
    getDisplayStringValue(data.notification.params.character) ??
    getPayloadDisplayStringValue(data.notification.payload, "character_name");
  const group =
    getDisplayStringValue(data.notification.params.group) ??
    getPayloadDisplayStringValue(data.notification.payload, "group_slug");
  const attendanceStatus =
    getStringValue(data.notification.params.attendance_status) ??
    getPayloadStringValue(data.notification.payload, "attendance_status");
  const startsAt = getNotificationStartsAt(data);

  if (activity) {
    details.activity = activity;
  }

  if (attendanceStatus) {
    details.attendanceStatus = attendanceStatus;
  }

  if (character) {
    details.character = character;
  }

  if (group) {
    details.group = group;
  }

  if (slot) {
    details.slot = slot;
  }

  if (startsAt) {
    details.startsAt = startsAt;
  }

  return details;
}

function hasAssignmentDetails(details: AssignmentDetails): boolean {
  return Boolean(
    details.activity ??
    details.attendanceStatus ??
    details.character ??
    (details.extraFields.length > 0 ? "extra_fields" : undefined) ??
    details.group ??
    details.slot ??
    details.startsAt,
  );
}

function getSlotDisplayName(data: NotificationDeliveryData): string | undefined {
  const slotGroup =
    getDisplayStringValue(data.notification.params.slot_group) ??
    getPayloadDisplayStringValue(data.notification.payload, "slot_group");
  const slot =
    getDisplayStringValue(data.notification.params.slot) ??
    getPayloadDisplayStringValue(data.notification.payload, "slot_label") ??
    getPayloadStringValue(data.notification.payload, "slot_key");

  return slotGroup ?? slot;
}

function getDesignationDisplayName(data: NotificationDeliveryData): string | undefined {
  return (
    getDisplayStringValue(data.notification.params.designation) ??
    getPayloadDisplayStringValue(data.notification.payload, "designation_label") ??
    getPayloadStringValue(data.notification.payload, "designation_key")
  );
}

function buildAssignmentSummary(
  subject: string,
  details: AssignmentDetails,
  action?: string,
): string {
  const activity = details.activity ? ` for ${details.activity}` : "";
  const group = details.group ? ` in ${details.group}` : "";
  const actionText = action ? ` ${action}` : "";

  return `${subject}${activity}${group}${actionText}.`;
}

function buildAssignmentFields(
  details: AssignmentDetails,
  fields: AssignmentFieldKey[],
): string | undefined {
  const lines = fields
    .flatMap((field) => {
      if (field === "extraFields") {
        return details.extraFields.map(
          (extraField) => `${extraField.label}: ${extraField.value}`,
        );
      }

      const value = details[field];

      return value ? [`${assignmentFieldLabels[field]}: ${value}`] : [];
    })
    .filter(Boolean);

  return lines.length > 0 ? lines.join("\n") : undefined;
}

type AssignmentFieldKey =
  | "attendanceStatus"
  | "character"
  | "extraFields"
  | "slot"
  | "startsAt";

const assignmentFieldLabels: Record<
  Exclude<AssignmentFieldKey, "extraFields">,
  string
> = {
  attendanceStatus: "Attendance",
  character: "Character",
  slot: "Slot",
  startsAt: "Scheduled start",
};

function joinDescriptionParts(summary: string, details: string | undefined): string {
  return details ? `${summary}\n\n${details}` : summary;
}

function getSocialAccountProvider(data: NotificationDeliveryData): string | undefined {
  return (
    getStringValue(data.notification.params.provider) ??
    getPayloadStringValue(data.notification.payload, "provider")
  );
}

function getCharacterDisplayName(data: NotificationDeliveryData): string | undefined {
  const character = getDisplayStringValue(data.notification.params.character);

  if (!character) {
    return undefined;
  }

  const world = getDisplayStringValue(data.notification.params.world);
  const datacenter = getDisplayStringValue(data.notification.params.datacenter);

  if (world && datacenter) {
    return `${character} (${world}, ${datacenter})`;
  }

  if (world) {
    return `${character} (${world})`;
  }

  return character;
}

function getRunDetails(data: NotificationDeliveryData): RunDetails {
  const details: RunDetails = {};
  const activity =
    getDisplayStringValue(data.notification.params.activity) ??
    getPayloadDisplayStringValue(data.notification.payload, "activity_title");
  const group =
    getDisplayStringValue(data.notification.params.group) ??
    getPayloadDisplayStringValue(data.notification.payload, "group_slug");
  const startsAt = getNotificationStartsAt(data);
  const status = getPayloadStringValue(data.notification.payload, "status");
  const completion = getRunCompletionDetails(data.notification.payload);

  if (activity) {
    details.activity = activity;
  }

  if (group) {
    details.group = group;
  }

  if (startsAt) {
    details.startsAt = startsAt;
  }

  if (status) {
    details.status = status;
  }

  if (completion) {
    details.completion = completion;
  }

  return details;
}

function hasRunDetails(details: RunDetails): boolean {
  return Boolean(
    details.activity ??
    details.group ??
    details.startsAt ??
    details.status ??
    (details.completion ? "completion" : undefined),
  );
}

function buildRunSummary(details: RunDetails, action: string): string {
  const activity = details.activity ?? "A run";
  const group = details.group ? ` in ${details.group}` : "";

  return `${activity}${group} ${action}.`;
}

function buildRunFields(details: RunDetails): string | undefined {
  const lines = [
    details.startsAt ? `Scheduled start: ${details.startsAt}` : undefined,
    details.status ? `Status: ${details.status}` : undefined,
    ...buildRunCompletionFields(details.completion),
  ].filter(isString);

  return lines.length > 0 ? lines.join("\n") : undefined;
}

function getPartyFinderDetails(data: NotificationDeliveryData): PartyFinderDetails {
  const partyFinder = getRecordValue(data.notification.payload, "party_finder");
  const details: PartyFinderDetails = {};
  const activity =
    getDisplayStringValue(data.notification.params.activity) ??
    getPayloadDisplayStringValue(data.notification.payload, "activity_title");
  const character =
    getDisplayStringValue(data.notification.params.character) ??
    getRecordStringValue(partyFinder, "character_name");
  const group =
    getDisplayStringValue(data.notification.params.group) ??
    getPayloadDisplayStringValue(data.notification.payload, "group_slug");
  const password =
    getDisplayStringValue(data.notification.params.password) ??
    getRecordStringValue(partyFinder, "password");
  const publishedAt = formatDiscordDateTime(
    getRecordStringValue(partyFinder, "published_at"),
  );
  const startsAt = getNotificationStartsAt(data);
  const status = getPayloadStringValue(data.notification.payload, "status");
  const world =
    getDisplayStringValue(data.notification.params.world) ??
    getRecordStringValue(partyFinder, "world");

  if (activity) {
    details.activity = activity;
  }

  if (character) {
    details.character = character;
  }

  if (group) {
    details.group = group;
  }

  if (password) {
    details.password = password;
  }

  if (publishedAt) {
    details.publishedAt = publishedAt;
  }

  if (startsAt) {
    details.startsAt = startsAt;
  }

  if (status) {
    details.status = status;
  }

  if (world) {
    details.world = world;
  }

  return details;
}

function hasPartyFinderDetails(details: PartyFinderDetails): boolean {
  return Boolean(
    details.activity ??
    details.character ??
    details.group ??
    details.password ??
    details.publishedAt ??
    details.startsAt ??
    details.status ??
    details.world,
  );
}

function buildPartyFinderSummary(details: PartyFinderDetails): string {
  const activity = details.activity ?? "Your run";
  const group = details.group ? ` in ${details.group}` : "";

  return `Party Finder was posted for ${activity}${group}.`;
}

function buildPartyFinderFields(details: PartyFinderDetails): string | undefined {
  const lines = [
    details.startsAt ? `Scheduled start: ${details.startsAt}` : undefined,
    details.character ? `Character: ${details.character}` : undefined,
    details.world ? `World: ${details.world}` : undefined,
    details.password ? `Password: ${formatInlineCode(details.password)}` : undefined,
    details.publishedAt ? `Posted at: ${details.publishedAt}` : undefined,
    details.status ? `Status: ${details.status}` : undefined,
  ].filter(isString);

  return lines.length > 0 ? lines.join("\n") : undefined;
}

function formatInlineCode(value: string): string {
  return `\`${value.replaceAll("`", "'")}\``;
}

function buildRunCompletionFields(
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

function getRunCompletionDetails(payload: unknown): RunCompletionDetails | undefined {
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

function getPayloadDisplayStringValue(payload: unknown, key: string): string | undefined {
  if (typeof payload !== "object" || payload === null || !(key in payload)) {
    return undefined;
  }

  return getDisplayStringValue((payload as Record<string, unknown>)[key]);
}

function getNotificationStartsAt(data: NotificationDeliveryData): string | undefined {
  return formatDiscordDateTime(
    getDisplayStringValue(data.notification.params.starts_at) ??
      getDisplayStringValue(data.notification.params.start_at) ??
      getPayloadRawStringValue(data.notification.payload, "starts_at") ??
      getPayloadRawStringValue(data.notification.payload, "start_at") ??
      getNestedPayloadRawStringValue(data.notification.payload, "run", "starts_at") ??
      getNestedPayloadRawStringValue(data.notification.payload, "run", "start_at") ??
      getNestedPayloadRawStringValue(
        data.notification.payload,
        "activity",
        "starts_at",
      ) ??
      getNestedPayloadRawStringValue(data.notification.payload, "activity", "start_at"),
  );
}

function getNestedPayloadRawStringValue(
  payload: unknown,
  nestedKey: string,
  key: string,
): string | undefined {
  return getRecordStringValue(getRecordValue(payload, nestedKey), key);
}

function getRoster(data: NotificationDeliveryData): Record<string, unknown> | undefined {
  return getRecordValue(data.notification.payload, "roster");
}

function getAssignmentExtraFields(
  data: NotificationDeliveryData,
): AssignmentDetailField[] {
  const rosterFields = getRosterExtraFields(data);

  return rosterFields.length > 0 ? rosterFields : getFallbackExtraFields(data);
}

function getRosterExtraFields(data: NotificationDeliveryData): AssignmentDetailField[] {
  const fields = getRecordUnknownValue(getRoster(data), "fields");

  if (!Array.isArray(fields)) {
    return [];
  }

  const seenLabels = new Set<string>();
  const extraFields: AssignmentDetailField[] = [];

  for (const field of fields) {
    if (!isRecord(field)) {
      continue;
    }

    const label = getRosterFieldLabel(field);
    const value = getRosterFieldDisplayValue(field);

    if (!label || !value || seenLabels.has(label)) {
      continue;
    }

    seenLabels.add(label);
    extraFields.push({ label, value });
  }

  return extraFields;
}

function getRosterFieldLabel(field: Record<string, unknown>): string | undefined {
  const label = getLocalizedLabel(field.label);

  if (label) {
    return label;
  }

  const key = getRecordStringValue(field, "key");

  return key ? humanizeIdentifier(key) : undefined;
}

function getRosterFieldDisplayValue(field: Record<string, unknown>): string | undefined {
  const value = getRecordUnknownValue(field, "value");
  const meta = getRecordUnknownValue(field, "meta");

  return (
    getDisplayStringValue(field.display_value) ??
    getLocalizedLabel(getRecordUnknownValue(value, "label")) ??
    getRecordStringValue(value, "name") ??
    getRecordStringValue(value, "display_value") ??
    getRecordStringValue(value, "key") ??
    getLocalizedLabel(getRecordUnknownValue(meta, "label")) ??
    getRecordStringValue(meta, "name") ??
    getRecordStringValue(meta, "display_value") ??
    getRecordStringValue(meta, "key") ??
    getLocalizedLabel(value) ??
    getLocalizedLabel(meta)
  );
}

function getFallbackExtraFields(data: NotificationDeliveryData): AssignmentDetailField[] {
  const characterClass = formatClassDisplayName(
    getDisplayStringValue(data.notification.params.class),
    getDisplayStringValue(data.notification.params.class_shorthand),
  );
  const position = getDisplayStringValue(data.notification.params.position);
  const fields: AssignmentDetailField[] = [];

  if (characterClass) {
    fields.push({ label: "Class", value: characterClass });
  }

  if (position) {
    fields.push({ label: "Position", value: position });
  }

  return fields;
}

function formatClassDisplayName(
  className: string | undefined,
  classShorthand: string | undefined,
): string | undefined {
  if (!className) {
    return classShorthand;
  }

  if (!classShorthand || className.toLowerCase() === classShorthand.toLowerCase()) {
    return className;
  }

  return `${className} (${classShorthand})`;
}

function getPayloadStringValue(payload: unknown, key: string): string | undefined {
  if (typeof payload !== "object" || payload === null || !(key in payload)) {
    return undefined;
  }

  return getStringValue((payload as Record<string, unknown>)[key]);
}

function getPayloadRawStringValue(payload: unknown, key: string): string | undefined {
  if (typeof payload !== "object" || payload === null || !(key in payload)) {
    return undefined;
  }

  return getDisplayStringValue((payload as Record<string, unknown>)[key]);
}

function getRecordUnknownValue(value: unknown, key: string): unknown {
  if (!isRecord(value)) {
    return undefined;
  }

  return value[key];
}

function getRecordValue(
  value: unknown,
  key: string,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const nestedValue = value[key];

  return isRecord(nestedValue) ? nestedValue : undefined;
}

function getRecordStringValue(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return getDisplayStringValue(value[key]);
}

function getRecordNumberValue(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const numberValue = value[key];

  return typeof numberValue === "number" && Number.isFinite(numberValue)
    ? numberValue
    : undefined;
}

function getNumberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getLocalizedLabel(value: unknown): string | undefined {
  if (typeof value === "string") {
    return getDisplayStringValue(value);
  }

  if (!isRecord(value)) {
    return undefined;
  }

  return getDisplayStringValue(value.en) ?? getFirstStringValue(value);
}

function getFirstStringValue(value: Record<string, unknown>): string | undefined {
  for (const nestedValue of Object.values(value)) {
    const stringValue = getDisplayStringValue(nestedValue);

    if (stringValue) {
      return stringValue;
    }
  }

  return undefined;
}

function getDisplayStringValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();

  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

function isString(value: string | undefined): value is string {
  return typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getStringValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    return undefined;
  }

  return humanizeIdentifier(trimmedValue);
}
