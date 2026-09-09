import type { APIEmbedField } from "discord.js";
import type { AutomationFailureDetailsSection } from "../automationFailureDetails.js";
import {
  createAutomationFailureDetailsCustomId,
  storeAutomationFailureDetails,
} from "../automationFailureDetails.js";
import { formatParticipantCharacterLabel } from "../participants.js";
import type { GuildRunCompletedData, GuildRunReminderData } from "../runReminderTypes.js";
import type { RunReminderFailure } from "../types.js";
import {
  formatPlural,
  formatReminderType,
  formatRunStartsLine,
  getRunAutomationActivityTitle,
  truncateText,
} from "./common.js";

export function createAutomationFailureDetailsId(input: {
  context?: string | undefined;
  sections: (AutomationFailureDetailsSection | undefined)[];
  title: string;
}): string | undefined {
  const sections = input.sections.filter(
    (section): section is AutomationFailureDetailsSection =>
      section !== undefined && section.details.length > 0,
  );

  if (sections.length === 0) {
    return undefined;
  }

  return storeAutomationFailureDetails({
    context: input.context,
    sections,
    title: input.title,
  });
}

export function createAutomationFailureSection(
  title: string,
  failures: RunReminderFailure[],
): AutomationFailureDetailsSection | undefined {
  if (failures.length === 0) {
    return undefined;
  }

  return {
    details: failures.map((failure) => ({
      reason: failure.error,
      subject:
        failure.discordUserId === "*"
          ? "General automation failure"
          : failure.discordUserId,
    })),
    title,
  };
}

export function createUnlinkedPlacedUsersSection(
  data: GuildRunReminderData,
  unlinkedCount: number,
): AutomationFailureDetailsSection | undefined {
  const unlinkedParticipants = data.unlinked_participants;

  if (unlinkedParticipants.length > 0) {
    return {
      details: unlinkedParticipants.map((participant) => {
        const characterLabel = formatParticipantCharacterLabel(participant);
        const subject = characterLabel ?? "Unlinked placed user";
        const context = [
          typeof participant.is_group_member === "boolean"
            ? `Group Member: ${participant.is_group_member ? "yes" : "no"}`
            : undefined,
          participant.group_role ? `Group Role: ${participant.group_role}` : undefined,
        ]
          .filter((value): value is string => Boolean(value))
          .join(", ");

        return {
          reason: `No Discord Account Linked.${context ? ` ${context}.` : ""}`,
          subject,
        };
      }),
      title: "Users Not Linked On FullParty",
    };
  }

  if (unlinkedCount <= 0) {
    return undefined;
  }

  return {
    details: [
      {
        reason:
          "FullParty reported placed users without an active linked Discord account. The site only sends this as a count, so the bot cannot name those users here yet.",
        subject: `${String(unlinkedCount)} unlinked ${formatPlural(unlinkedCount, "user")}`,
      },
    ],
    title: "Users Not Linked On FullParty",
  };
}

export function createAutomationFailureDetailsContext(
  data: GuildRunReminderData,
): string {
  const runTitle = getRunAutomationActivityTitle(data);
  const runLabel = runTitle
    ? `Run #${String(data.run_id)} - ${runTitle}`
    : `Run #${String(data.run_id)}`;

  return [
    runLabel,
    formatReminderType(data.reminder_type).replaceAll("*", ""),
    formatRunStartsLine(data.starts_at)?.replace("**Starts:** ", "Starts: "),
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

export function createRunCompletedFailureDetailsContext(
  data: GuildRunCompletedData,
): string {
  const runTitle = getRunAutomationActivityTitle(data);
  const runLabel = runTitle
    ? `Run #${String(data.run_id)} - ${runTitle}`
    : `Run #${String(data.run_id)}`;

  return [
    runLabel,
    data.type === "runs.cancelled" ? "Cancelled" : "Completed",
    data.group_slug ? `Group: ${data.group_slug}` : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

export function createFailureDetailsButtonRow(detailsId: string) {
  return {
    components: [
      {
        custom_id: createAutomationFailureDetailsCustomId(detailsId),
        emoji: {
          name: "🔎",
        },
        label: "Failure Details",
        style: 2,
        type: 2,
      },
    ],
    type: 1,
  } as const;
}

export function createFailuresField(
  failures: RunReminderFailure[],
): APIEmbedField | undefined {
  if (failures.length === 0) {
    return undefined;
  }

  const visibleFailures = failures.slice(0, 5);
  const hiddenFailureCount = failures.length - visibleFailures.length;
  const lines = visibleFailures.map(
    (failure) => `\`${failure.discordUserId}\`: ${truncateText(failure.error, 120)}`,
  );

  if (hiddenFailureCount > 0) {
    lines.push(`...and ${String(hiddenFailureCount)} more failure(s).`);
  }

  return {
    inline: false,
    name: "Failure Details",
    value: lines.join("\n"),
  };
}
