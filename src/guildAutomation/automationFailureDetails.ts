import {
  MessageFlags,
  type ButtonInteraction,
  type InteractionReplyOptions,
} from "discord.js";

export const automationFailureDetailsCustomIdPrefix = "automationfailures";

export type AutomationFailureDetail = {
  reason: string;
  subject: string;
};

export type AutomationFailureDetailsSection = {
  details: AutomationFailureDetail[];
  title: string;
};

export type AutomationFailureDetailsRecord = {
  context?: string | undefined;
  sections: AutomationFailureDetailsSection[];
  title: string;
};

const maxStoredRecords = 500;
const recordTtlMs = 24 * 60 * 60 * 1000;
const maxDiscordMessageLength = 1900;

type StoredAutomationFailureDetailsRecord = AutomationFailureDetailsRecord & {
  createdAt: number;
};

const records = new Map<string, StoredAutomationFailureDetailsRecord>();

export function storeAutomationFailureDetails(
  record: AutomationFailureDetailsRecord,
): string | undefined {
  const sections = record.sections
    .map((section) => ({
      ...section,
      details: section.details.filter(
        (detail) => detail.subject.trim().length > 0 || detail.reason.trim().length > 0,
      ),
    }))
    .filter((section) => section.details.length > 0);

  if (sections.length === 0) {
    return undefined;
  }

  pruneAutomationFailureDetails();

  const id = createAutomationFailureDetailsId();
  records.set(id, {
    ...record,
    createdAt: Date.now(),
    sections,
  });

  return id;
}

export function createAutomationFailureDetailsCustomId(id: string): string {
  return `${automationFailureDetailsCustomIdPrefix}:${id}`;
}

export function isAutomationFailureDetailsCustomId(customId: string): boolean {
  return (
    customId === automationFailureDetailsCustomIdPrefix ||
    customId.startsWith(`${automationFailureDetailsCustomIdPrefix}:`)
  );
}

export async function replyWithAutomationFailureDetails(
  interaction: ButtonInteraction,
): Promise<void> {
  const id = parseAutomationFailureDetailsCustomId(interaction.customId);
  const record = id ? records.get(id) : undefined;

  if (!record || Date.now() - record.createdAt > recordTtlMs) {
    if (id) {
      records.delete(id);
    }

    await interaction.reply({
      content:
        "Those automation failure details are no longer available. Run the automation again to capture a fresh report.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const messages = splitAutomationFailureDetails(record);
  const [firstMessage, ...remainingMessages] = messages;
  const replyOptions: InteractionReplyOptions = {
    allowedMentions: {
      parse: [],
    },
    content: firstMessage ?? "No failure details were recorded for this automation.",
    flags: MessageFlags.Ephemeral,
  };

  await interaction.reply(replyOptions);

  for (const message of remainingMessages) {
    await interaction.followUp({
      allowedMentions: {
        parse: [],
      },
      content: message,
      flags: MessageFlags.Ephemeral,
    });
  }
}

function parseAutomationFailureDetailsCustomId(customId: string): string | undefined {
  const [prefix, id, ...extraParts] = customId.split(":");

  if (prefix !== automationFailureDetailsCustomIdPrefix || !id || extraParts.length > 0) {
    return undefined;
  }

  return id;
}

function splitAutomationFailureDetails(
  record: StoredAutomationFailureDetailsRecord,
): string[] {
  const lines = [
    `**${record.title}**`,
    record.context,
    `Captured <t:${String(Math.floor(record.createdAt / 1000))}:R>.`,
    "",
    ...record.sections.flatMap((section) => [
      `**${section.title}**`,
      ...section.details.map(
        (detail) => `• \`${detail.subject}\` - ${truncateDetail(detail.reason)}`,
      ),
      "",
    ]),
  ].filter((line): line is string => line !== undefined);

  const messages: string[] = [];
  let currentMessage = "";

  for (const line of lines) {
    const nextMessage = currentMessage ? `${currentMessage}\n${line}` : line;

    if (nextMessage.length > maxDiscordMessageLength && currentMessage) {
      messages.push(currentMessage);
      currentMessage = line;
      continue;
    }

    currentMessage = nextMessage;
  }

  if (currentMessage) {
    messages.push(currentMessage);
  }

  return messages;
}

function truncateDetail(value: string): string {
  return value.length > 400 ? `${value.slice(0, 397)}...` : value;
}

function createAutomationFailureDetailsId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function pruneAutomationFailureDetails(): void {
  const now = Date.now();

  for (const [id, record] of records) {
    if (now - record.createdAt > recordTtlMs) {
      records.delete(id);
    }
  }

  while (records.size >= maxStoredRecords) {
    const oldestKey = records.keys().next().value;

    if (typeof oldestKey !== "string") {
      return;
    }

    records.delete(oldestKey);
  }
}
