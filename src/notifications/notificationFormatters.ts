import {
  getCharacterDisplayName,
  getSocialAccountProvider,
} from "./formatters/accounts.js";
import { formatApplicationNotification } from "./formatters/applications.js";
import {
  buildAssignmentFields,
  buildAssignmentSummary,
  getAssignmentDetails,
  getDesignationDisplayName,
  hasAssignmentDetails,
} from "./formatters/assignments.js";
import {
  buildPartyFinderFields,
  buildPartyFinderSummary,
  getPartyFinderDetails,
  hasPartyFinderDetails,
} from "./formatters/partyFinder.js";
import {
  buildRunFields,
  buildRunSummary,
  getRunDetails,
  hasRunDetails,
} from "./formatters/runs.js";
import { getStringValue, joinDescriptionParts } from "./formatters/values.js";
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

export function formatNotificationCopy(
  data: NotificationDeliveryData,
  copy: NotificationCopy,
): NotificationCopy {
  return formatterByType[data.notification.type]?.(data, copy) ?? copy;
}
