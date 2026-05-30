import type { MessageCreateOptions } from "discord.js";

const discordMessageContentLimit = 2000;
const payloadChunkSize = 1750;

export function createEventDebugMessages(
  payload: unknown,
  label = "FullParty payload",
): MessageCreateOptions[] {
  const serializedPayload = stringifyPayload(payload);
  const chunks = chunkText(serializedPayload, payloadChunkSize);

  return chunks.map((chunk, index) => ({
    content: createDebugMessageContent(chunk, index, chunks.length, label),
  }));
}

function stringifyPayload(payload: unknown): string {
  try {
    const serializedPayload = JSON.stringify(payload, null, 2);

    return typeof serializedPayload === "string" ? serializedPayload : "null";
  } catch {
    return String(payload);
  }
}

function chunkText(value: string, chunkSize: number): string[] {
  if (value.length === 0) {
    return [""];
  }

  const chunks: string[] = [];

  for (let index = 0; index < value.length; index += chunkSize) {
    chunks.push(value.slice(index, index + chunkSize));
  }

  return chunks;
}

function createDebugMessageContent(
  chunk: string,
  index: number,
  totalChunks: number,
  heading: string,
): string {
  const label =
    totalChunks === 1
      ? `${heading}:`
      : `${heading} (${String(index + 1)}/${String(totalChunks)}):`;
  const content = `${label}\n\`\`\`json\n${chunk}\n\`\`\``;

  return content.length <= discordMessageContentLimit
    ? content
    : `${label}\n\`\`\`\n${chunk}\n\`\`\``.slice(0, discordMessageContentLimit);
}
