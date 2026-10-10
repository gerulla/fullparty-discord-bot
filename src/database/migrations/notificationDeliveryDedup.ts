import type { DatabaseSync } from "node:sqlite";

export function notificationDeliveryDedup(database: DatabaseSync): void {
  database.exec(`
    ALTER TABLE user_dm_jobs ADD COLUMN notification_delivery_id INTEGER;
    CREATE UNIQUE INDEX user_dm_jobs_notification_delivery_idx
      ON user_dm_jobs(discord_user_id, notification_delivery_id)
      WHERE notification_delivery_id IS NOT NULL AND status IN ('queued', 'sent');
  `);
}
