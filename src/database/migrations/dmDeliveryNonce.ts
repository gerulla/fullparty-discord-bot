import type { DatabaseSync } from "node:sqlite";

export function dmDeliveryNonce(database: DatabaseSync): void {
  database.exec(`
    ALTER TABLE user_dm_jobs ADD COLUMN first_attempt_at INTEGER;
    ALTER TABLE user_dm_jobs ADD COLUMN outcome_uncertain INTEGER NOT NULL DEFAULT 0
      CHECK(outcome_uncertain IN (0, 1));
    DROP INDEX user_dm_jobs_notification_delivery_idx;
    CREATE UNIQUE INDEX user_dm_jobs_notification_delivery_idx
      ON user_dm_jobs(discord_user_id, notification_delivery_id)
      WHERE notification_delivery_id IS NOT NULL
        AND (status IN ('queued', 'sent') OR outcome_uncertain = 1);

    -- Never-attempted legacy jobs can safely start with a new persisted nonce.
    -- Previously attempted jobs have no protected send identity and require review.
    UPDATE user_dm_jobs
    SET payload_json = json_set(payload_json,
      '$.message.nonce', lower(hex(randomblob(12))),
      '$.message.enforceNonce', json('true'))
    WHERE status = 'queued' AND attempts = 0;
  `);
}
