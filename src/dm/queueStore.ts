import type { DatabaseSync } from "node:sqlite";
import { openSqliteDatabase } from "../database/sqlite.js";
import { dmDeliveryJobSchema, type DmDeliveryJob } from "./deliveryTypes.js";

export type StoredDmJob = { id: number; queuedAt: number; payload: DmDeliveryJob };
export type DmQueueStore = Pick<
  SqliteDmQueueStore,
  "enqueue" | "pending" | "complete" | "sentTimes" | "recordSent" | "close"
>;

export class SqliteDmQueueStore {
  private readonly database: DatabaseSync;
  public constructor(databasePath: string) {
    this.database = openSqliteDatabase(databasePath);
  }

  public enqueue(payload: DmDeliveryJob): number {
    const validated = dmDeliveryJobSchema.parse(payload);
    return Number(
      this.database
        .prepare(
          "INSERT INTO user_dm_jobs (discord_user_id, payload_json, queued_at) VALUES (?, ?, ?)",
        )
        .run(validated.discordUserId, JSON.stringify(validated), Date.now())
        .lastInsertRowid,
    );
  }

  public pending(): StoredDmJob[] {
    return this.database
      .prepare(
        "SELECT id, payload_json, queued_at FROM user_dm_jobs WHERE status = 'queued' ORDER BY id",
      )
      .all()
      .map((row) => {
        if (
          typeof row.id !== "number" ||
          typeof row.queued_at !== "number" ||
          typeof row.payload_json !== "string"
        )
          throw new Error("Invalid persisted DM job.");
        return {
          id: row.id,
          queuedAt: row.queued_at,
          payload: dmDeliveryJobSchema.parse(JSON.parse(row.payload_json) as unknown),
        };
      });
  }

  public complete(id: number, error?: string): void {
    this.database
      .prepare(
        "UPDATE user_dm_jobs SET status = ?, completed_at = ?, error = ? WHERE id = ?",
      )
      .run(error === undefined ? "sent" : "failed", Date.now(), error ?? null, id);
  }

  public sentTimes(windowMs: number): Map<string, number[]> {
    this.prune(windowMs);
    const result = new Map<string, number[]>();
    for (const row of this.database
      .prepare("SELECT discord_user_id, sent_at FROM user_dm_sent_times ORDER BY sent_at")
      .all()) {
      if (typeof row.discord_user_id !== "string" || typeof row.sent_at !== "number")
        throw new Error("Invalid persisted DM cooldown.");
      const times = result.get(row.discord_user_id) ?? [];
      times.push(row.sent_at);
      result.set(row.discord_user_id, times);
    }
    return result;
  }

  public recordSent(discordUserId: string, sentAt: number, windowMs: number): void {
    this.database
      .prepare("INSERT INTO user_dm_sent_times (discord_user_id, sent_at) VALUES (?, ?)")
      .run(discordUserId, sentAt);
    this.prune(windowMs);
  }

  public close(): void {
    this.database.close();
  }

  private prune(windowMs: number): void {
    this.database
      .prepare("DELETE FROM user_dm_sent_times WHERE sent_at <= ?")
      .run(Date.now() - windowMs);
    this.database
      .prepare("DELETE FROM user_dm_jobs WHERE status != 'queued' AND completed_at < ?")
      .run(Date.now() - 30 * 24 * 60 * 60 * 1000);
  }
}
