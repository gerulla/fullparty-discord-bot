import type { MessageCreateOptions } from "discord.js";
import { z } from "zod";
import { HttpError } from "../http/httpError.js";
import type { WebhookServerOptions } from "../http/types.js";
import { sendUserDm } from "./deliveryService.js";

export const adminReportEvent = "discord.admin.report";

export const adminReportDataSchema = z.object({
  title: z.string().trim().min(1).max(256),
  message: z.string().trim().min(1).max(4096),
  severity: z.enum(["info", "warning", "error", "critical"]).default("error"),
  url: z
    .string()
    .trim()
    .max(2048)
    .pipe(z.url({ protocol: /^https?$/u }))
    .optional(),
});

type AdminReportData = z.infer<typeof adminReportDataSchema>;

const severityColors: Record<AdminReportData["severity"], number> = {
  info: 0x3b82f6,
  warning: 0xf59e0b,
  error: 0xd83c3e,
  critical: 0x991b1b,
};

export async function sendAdminReport(
  options: Pick<WebhookServerOptions, "client" | "context">,
  data: AdminReportData,
) {
  const discordUserId = options.context.payloadCommandAllowedUserId;
  if (!discordUserId) {
    throw new HttpError(
      503,
      "admin_report_recipient_not_configured",
      "Set PAYLOAD_COMMAND_ALLOWED_USER_ID to receive admin reports.",
    );
  }

  return sendUserDm(options, discordUserId, createAdminReportMessage(data), {
    eventType: adminReportEvent,
    notificationType: `admin.report.${data.severity}`,
  });
}

function createAdminReportMessage(data: AdminReportData): MessageCreateOptions {
  return {
    embeds: [
      {
        title: data.title,
        description: data.message,
        color: severityColors[data.severity],
        footer: { text: `FullParty admin report • ${data.severity.toUpperCase()}` },
        timestamp: new Date().toISOString(),
        ...(data.url ? { url: data.url } : {}),
      },
    ],
  };
}
