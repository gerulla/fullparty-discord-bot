import type { Client } from "discord.js";
import type { BotContext } from "../bot/context.js";
import { recordAdminGuildMessage } from "../admin/telemetryRecorder.js";
import { FullpartyApiError } from "../fullparty/client.js";
import { sendBotLogMessage } from "../guildAutomation/messages.js";
import { isExpectedDiscordFailure, reportError } from "../health/errorReporter.js";
import { recordFailureSafely, serializeFailureError } from "../health/failureReporter.js";
import { getDiscordApiErrorCode, getErrorMessage } from "../lib/errors.js";
import { ScheduleRefreshError, type GuildSchedulePublisher } from "./publisher.js";
import type { ScheduleJob, SqliteGuildScheduleStore } from "./store.js";

type SchedulerOptions = {
  client: Client;
  context: BotContext;
  store: SqliteGuildScheduleStore;
  publisher: Pick<GuildSchedulePublisher, "replace">;
  now?: () => Date;
};

export class GuildScheduleScheduler {
  private running = false;
  private timer: NodeJS.Timeout | undefined;
  private work: Promise<void> | undefined;
  private readonly now: () => Date;
  public constructor(private readonly options: SchedulerOptions) {
    this.now = options.now ?? (() => new Date());
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => {
      void this.tick();
    }, 60_000);
    this.timer.unref();
    void this.tick();
    this.options.context.logger.info("Guild schedule refresh scheduler started.", {
      sweepIntervalMs: 60_000,
      concurrency: 1,
    });
  }

  public async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.work;
  }

  public tick(): Promise<void> {
    if (!this.running) return Promise.resolve();
    if (this.work) return this.work;
    this.work = this.sweep()
      .catch((error: unknown) => {
        reportError(this.options.context, error, {
          source: "queue",
          action: "schedule_refresh_sweep",
        });
      })
      .finally(() => {
        this.work = undefined;
      });
    return this.work;
  }

  private async sweep(): Promise<void> {
    const { client, store } = this.options;
    if (!client.isReady()) return;
    // Due jobs remain in SQLite until successful; process serially to avoid guild-wide bursts.
    for (const job of store.listDue(this.now())) {
      if (!this.running || !client.isReady()) break;
      const guild = client.guilds.cache.get(job.guild_id);
      if (!guild || !guild.available || !store.isCurrent(job)) continue;
      await this.refresh(job);
    }
  }

  private async refresh(job: ScheduleJob): Promise<void> {
    const { store, publisher, context, client } = this.options;
    store.markAttempt(job, this.now());
    try {
      const messageId = await publisher.replace(
        job,
        () =>
          this.running &&
          client.isReady() &&
          client.guilds.cache.has(job.guild_id) &&
          store.isCurrent(job),
      );
      if (!messageId) return;
      store.complete(job, messageId, this.now());
      context.logger.info("Guild schedule refreshed.", {
        discordGuildId: job.guild_id,
        channelId: job.channel_id,
        intervalDays: job.interval_days,
        messageId,
      });
      recordAdminGuildMessage(context.adminStore, context.logger, {
        discordGuildId: job.guild_id,
        channelId: job.channel_id,
        messageId,
        messageType: "schedule_refresh",
        status: "sent",
      });
    } catch (error) {
      const message = getErrorMessage(error);
      const code =
        error instanceof ScheduleRefreshError
          ? error.code
          : error instanceof FullpartyApiError
            ? `fullparty_api_${String(error.status)}`
            : getDiscordApiErrorCode(error);
      const expected =
        error instanceof ScheduleRefreshError ||
        isExpectedDiscordFailure(error) ||
        ["10003", "10008"].includes(code ?? "") ||
        (error instanceof FullpartyApiError && [401, 403, 404].includes(error.status));
      store.fail(job, message, this.now());
      context.logger[expected ? "warn" : "error"]("Guild schedule refresh failed.", {
        discordGuildId: job.guild_id,
        error: serializeFailureError(error),
      });
      recordFailureSafely(context.failureReporter, context.logger, {
        action: "schedule_refresh",
        source: "guild_automation",
        discordGuildId: job.guild_id,
        message,
        errorCode: code,
        affectsHealth: !expected,
        severity: expected ? "warn" : "error",
        details: { channelId: job.channel_id, error: serializeFailureError(error) },
      });
      recordAdminGuildMessage(context.adminStore, context.logger, {
        discordGuildId: job.guild_id,
        channelId: job.channel_id,
        messageType: "schedule_refresh",
        status: "failed",
        errorCode: code,
        errorMessage: message,
      });
      if (job.last_error !== message && store.isCurrent(job)) {
        const settings = await context.guildSettings.get(job.guild_id);
        await sendBotLogMessage(
          { client, context },
          settings.botLogChannelId,
          {
            content: `Automatic schedule refresh failed for <#${job.channel_id}>. ${expected ? "Check channel access and the FullParty server link in /setup." : "The failure has been recorded in the bot logs."} The bot will retry in one hour.`,
            allowedMentions: { parse: [] },
          },
          { discordGuildId: job.guild_id, messageType: "schedule_refresh_warning" },
        );
      }
    }
  }
}
