import { REST, Routes, type RawFile } from "discord.js";
import { getDiscordApiErrorCode } from "../lib/errors.js";
import { isRecord } from "../lib/valueReaders.js";
import { parseJsonPreview, PreviewInputError } from "./jsonPreview.js";

const maxUploadBytes = 8 * 1024 * 1024;
const attachmentPrefix = "attachment://";

export class WorkshopSendError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "WorkshopSendError";
  }
}

export function createWorkshopSender(options: {
  env: Record<string, string | undefined>;
  rest?: Pick<REST, "post">;
}) {
  const { env } = options;
  const token = env.DISCORD_TOKEN?.trim() ?? "";
  const recipient = env.PAYLOAD_COMMAND_ALLOWED_USER_ID?.trim();
  const disabledReason =
    (env.NODE_ENV ?? "development") !== "development"
      ? "Sending previews is available only in development."
      : env.DEV_JSON_ENABLED !== "true"
        ? "Enable DEV_JSON_ENABLED to send previews from this workshop."
        : !isSnowflake(recipient)
          ? "Configure a valid PAYLOAD_COMMAND_ALLOWED_USER_ID to receive previews."
          : !token
            ? "Configure DISCORD_TOKEN for the development bot to send previews."
            : undefined;
  let rest = options.rest;
  let sending = false;

  return {
    status(): { enabled: boolean; reason?: string } {
      return disabledReason
        ? { enabled: false, reason: disabledReason }
        : { enabled: true };
    },
    async send(draft: unknown): Promise<{ messageId: string }> {
      if (disabledReason) throw new WorkshopSendError(503, disabledReason);
      if (sending)
        throw new WorkshopSendError(
          429,
          "A preview is already being sent. Wait for it to finish.",
        );
      sending = true;
      try {
        const { body, files } = prepareDraft(draft);
        rest ??= new REST({ version: "10", timeout: 15_000, retries: 0 }).setToken(token);
        const channel = await rest.post(Routes.userChannels(), {
          body: { recipient_id: recipient },
        });
        if (!isRecord(channel) || !isSnowflake(channel.id)) {
          throw new WorkshopSendError(
            502,
            "Discord did not return a valid DM channel. Try again.",
          );
        }
        const message = await rest.post(Routes.channelMessages(channel.id), {
          body,
          ...(files.length ? { files } : {}),
        });
        if (!isRecord(message) || !isSnowflake(message.id)) {
          throw new WorkshopSendError(
            502,
            "Discord did not confirm the preview message. Check your DMs before retrying.",
          );
        }
        return { messageId: message.id };
      } catch (error) {
        if (error instanceof WorkshopSendError) throw error;
        if (error instanceof PreviewInputError)
          throw new WorkshopSendError(400, error.message);
        throw discordFailure(error, token);
      } finally {
        sending = false;
      }
    },
  };
}

type Upload = { dataUrl: string; name: string; description?: string };

function prepareDraft(draft: unknown): {
  body: Record<string, unknown>;
  files: RawFile[];
} {
  if (!isObject(draft) || !isObject(draft.message)) {
    throw inputError("Send a workshop draft containing a message object.");
  }
  const message = draft.message;
  const assets = array(draft.assets, "Uploaded assets");
  const messageFiles = array(message.files, "Message files");
  if (assets.length > 10 || messageFiles.length > 10)
    throw inputError("Use up to 10 uploaded attachments per preview.");
  if (array(message.attachments, "Existing attachments").length) {
    throw inputError(
      "Existing attachment metadata cannot be resent. Upload the files in this workshop instead.",
    );
  }
  const assetsByName = new Map<string, string>();
  for (const asset of assets) {
    if (
      !isObject(asset) ||
      typeof asset.name !== "string" ||
      typeof asset.dataUrl !== "string"
    ) {
      throw inputError("Each uploaded asset needs a filename and a base64 data URL.");
    }
    sanitizeName(asset.name);
    if (assetsByName.has(asset.name))
      throw inputError("Uploaded attachment names must be unique.");
    assetsByName.set(asset.name, asset.dataUrl);
  }
  const uploads = new Map<string, Upload>();
  const outputNames = new Set<string>();
  function addUpload(
    source: string,
    name = source,
    description?: unknown,
    spoiler?: unknown,
  ): Upload {
    const dataUrl = assetsByName.get(source);
    if (!dataUrl)
      throw inputError(
        "An attachment references a missing uploaded asset. Upload it in the Files tab first.",
      );
    const filename = `${spoiler === true && !name.startsWith("SPOILER_") ? "SPOILER_" : ""}${sanitizeName(name)}`;
    if (outputNames.has(filename))
      throw inputError("Attachment filenames must be unique after sanitization.");
    if (
      description !== undefined &&
      (typeof description !== "string" || description.length > 1024)
    ) {
      throw inputError("Attachment descriptions must be text of up to 1024 characters.");
    }
    const upload: Upload = {
      dataUrl,
      name: filename,
      ...(typeof description === "string" && description.trim() ? { description } : {}),
    };
    uploads.set(source, upload);
    outputNames.add(filename);
    return upload;
  }
  for (const file of messageFiles) {
    if (
      !isObject(file) ||
      typeof file.attachment !== "string" ||
      !file.attachment.startsWith(attachmentPrefix)
    ) {
      throw inputError(
        "Message files must reference uploaded assets with attachment://filename. Local paths and remote file downloads are not supported.",
      );
    }
    const source = file.attachment.slice(attachmentPrefix.length);
    if (uploads.has(source))
      throw inputError("The same uploaded asset cannot be attached twice.");
    if (file.name !== undefined && typeof file.name !== "string")
      throw inputError("Attachment filenames must be text.");
    addUpload(
      source,
      typeof file.name === "string" ? file.name : source,
      file.description,
      file.spoiler,
    );
  }
  function rewrite(value: unknown, depth = 0): unknown {
    if (depth > 30) throw inputError("The draft is nested too deeply.");
    if (typeof value === "string" && value.startsWith(attachmentPrefix)) {
      const source = value.slice(attachmentPrefix.length);
      const upload = uploads.get(source) ?? addUpload(source);
      return attachmentPrefix + upload.name;
    }
    if (Array.isArray(value)) return value.map((item) => rewrite(item, depth + 1));
    if (isObject(value))
      return Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [key, rewrite(nested, depth + 1)]),
      );
    return value;
  }
  const messageFields = { ...message };
  delete messageFields.files;
  delete messageFields.attachments;
  const normalized = rewrite(messageFields);
  if (!isObject(normalized)) throw inputError("The draft message must be an object.");
  if (uploads.size > 10)
    throw inputError("Use up to 10 uploaded attachments per preview.");
  const files: RawFile[] = [];
  const attachments: { id: number; filename: string; description?: string }[] = [];
  let totalBytes = 0;
  for (const upload of uploads.values()) {
    const decoded = decodeUpload(upload.dataUrl);
    totalBytes += decoded.data.length;
    if (totalBytes > maxUploadBytes)
      throw inputError("Preview attachments must total 8 MiB or less after decoding.");
    attachments.push({
      id: files.length,
      filename: upload.name,
      ...(upload.description ? { description: upload.description } : {}),
    });
    files.push({
      data: decoded.data,
      name: upload.name,
      contentType: decoded.contentType,
    });
  }
  let source: string;
  try {
    source = JSON.stringify({
      ...normalized,
      ...(files.length ? { files: attachments } : {}),
    });
  } catch {
    throw inputError("The draft must contain JSON-compatible message data.");
  }
  // Uploads and attachment references are validated above; the parser still removes
  // destination fields, dangerous flags and live custom IDs, and disables mentions.
  const body = parseJsonPreview(source, { allowAttachments: true });
  if (attachments.length) body.attachments = attachments;
  return { body, files };
}

function decodeUpload(dataUrl: string): { data: Buffer; contentType: string } {
  if (dataUrl.length > Math.ceil(maxUploadBytes / 3) * 4 + 256)
    throw inputError("Preview attachments must total 8 MiB or less after decoding.");
  const match =
    /^data:([a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*)?;base64,([A-Za-z0-9+/]*={0,2})$/u.exec(
      dataUrl,
    );
  const encoded = match?.[2];
  if (!match || !encoded || encoded.length % 4 !== 0)
    throw inputError("Uploaded assets must contain valid base64 data URLs.");
  const data = Buffer.from(encoded, "base64");
  if (data.toString("base64") !== encoded)
    throw inputError("Uploaded assets must contain valid base64 data URLs.");
  return { data, contentType: match[1] ?? "application/octet-stream" };
}

function sanitizeName(value: string): string {
  if (
    !value.trim() ||
    value.length > 200 ||
    /[\\/\p{Cc}]/u.test(value) ||
    [".", ".."].includes(value)
  ) {
    throw inputError("Attachment filenames must be plain names without paths.");
  }
  return value.replaceAll(/[^A-Za-z0-9._-]/gu, "_");
}

function array(value: unknown, label: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw inputError(`${label} must be an array.`);
  return value as unknown[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value);
}

function isSnowflake(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[1-9]\d{16,19}$/u.test(value) &&
    BigInt(value) <= 18446744073709551615n
  );
}

function inputError(message: string): WorkshopSendError {
  return new WorkshopSendError(400, message);
}

function discordFailure(error: unknown, token: string | undefined): WorkshopSendError {
  const code = getDiscordApiErrorCode(error);
  const status = isRecord(error) ? error.status : undefined;
  if (status === 401 || code === "50014")
    return new WorkshopSendError(
      503,
      "Discord could not authenticate the development bot. Check its token configuration.",
    );
  if (status === 403 || ["50007", "50001", "50013", "10013"].includes(code ?? ""))
    return new WorkshopSendError(
      403,
      "Discord could not deliver the preview to the configured owner. Check DM privacy settings and bot access.",
    );
  if (status === 400 || ["50035", "50006"].includes(code ?? "")) {
    const details = discordFormErrors(error, token);
    return new WorkshopSendError(
      400,
      details
        ? `Discord rejected this message:\n${details}`
        : "Discord rejected this message. Check the message fields and Discord component limits, then try again.",
    );
  }
  if (status === 429)
    return new WorkshopSendError(
      429,
      "Discord is rate limiting previews. Wait briefly before retrying.",
    );
  return new WorkshopSendError(
    502,
    "Could not confirm delivery with Discord. Check your DMs before retrying.",
  );
}

function discordFormErrors(error: unknown, token: string | undefined): string {
  if (!isObject(error) || !isObject(error.rawError)) return "";
  const lines: string[] = [];
  let visited = 0;
  function visit(value: unknown, path: string, depth: number): void {
    if (!isObject(value) || depth > 10 || ++visited > 100 || lines.length >= 6) return;
    if (Array.isArray(value._errors)) {
      for (const problem of value._errors.slice(0, 6 - lines.length)) {
        if (!isObject(problem) || typeof problem.message !== "string") continue;
        const detail = (
          token ? problem.message.replaceAll(token, "[redacted]") : problem.message
        )
          .replaceAll(/\p{Cc}/gu, " ")
          .slice(0, 160);
        const code =
          typeof problem.code === "string" && /^[A-Z0-9_]{1,64}$/u.test(problem.code)
            ? ` [${problem.code}]`
            : "";
        lines.push(`${path || "message"}${code}: ${detail}`);
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === "_errors" || !/^[A-Za-z0-9_]{1,64}$/u.test(key) || lines.length >= 6)
        continue;
      const segment = /^\d+$/u.test(key) ? `[${key}]` : `${path ? "." : ""}${key}`;
      visit(child, (path + segment).slice(0, 180), depth + 1);
    }
  }
  visit(error.rawError.errors, "", 0);
  const details = lines.join("\n");
  return (token ? details.replaceAll(token, "[redacted]") : details).slice(0, 1600);
}
