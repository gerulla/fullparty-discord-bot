import { z } from "zod";

import notificationCopyCatalogJson from "./notificationCopy.json" with { type: "json" };
import { humanizeIdentifier } from "./notificationText.js";
import type { NotificationCopy } from "./types.js";

const notificationToneSchema = z.enum([
  "danger",
  "info",
  "neutral",
  "success",
  "warning",
]);

const notificationCopySchema = z.object({
  actionLabel: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1),
  title: z.string().trim().min(1),
  tone: notificationToneSchema,
});

const notificationCopyCatalogSchema = z.object({
  fallback: notificationCopySchema,
  types: z.record(z.string(), notificationCopySchema),
});

const notificationCopyCatalog = notificationCopyCatalogSchema.parse(
  notificationCopyCatalogJson,
);

export function getNotificationCopy(notificationType: string): NotificationCopy {
  return (
    notificationCopyCatalog.types[notificationType] ?? {
      ...notificationCopyCatalog.fallback,
      title: humanizeIdentifier(notificationType),
    }
  );
}

export function getSupportedNotificationTypes(): string[] {
  return Object.keys(notificationCopyCatalog.types).sort();
}
