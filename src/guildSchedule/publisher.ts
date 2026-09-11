import { createHash } from "node:crypto";
import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  type Client,
  type NewsChannel,
  type TextChannel,
} from "discord.js";
import { z } from "zod";
import type { BotContext } from "../bot/context.js";
import { createGuildUpcomingRunsPostMessage } from "../fullparty/discordGuildRunPosts.js";
import { getDiscordApiErrorCode } from "../lib/errors.js";
import type { ScheduleJob, SqliteGuildScheduleStore } from "./store.js";

export class ScheduleRefreshError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ScheduleRefreshError";
  }
}

const runsResponseSchema = z.looseObject({
  data: z.array(z.record(z.string(), z.unknown())),
  meta: z.looseObject({ discord_guild_id: z.string().optional() }).optional(),
});

export class GuildSchedulePublisher {
  public constructor(
    private readonly client: Client,
    private readonly context: Pick<BotContext, "fullparty" | "fullpartyWebBaseUrl">,
    private readonly store: Pick<SqliteGuildScheduleStore, "clearMessage">,
  ) {}

  public async replace(
    job: ScheduleJob,
    canContinue: () => boolean,
  ): Promise<string | undefined> {
    const channel = await this.getChannel(job.channel_id, job.guild_id);
    const bot = channel.guild.members.me ?? (await channel.guild.members.fetchMe());
    const permissions = channel.permissionsFor(bot);
    const required = [
      [PermissionFlagsBits.ViewChannel, "View Channel"],
      [PermissionFlagsBits.SendMessages, "Send Messages"],
      [PermissionFlagsBits.ReadMessageHistory, "Read Message History"],
    ] as const;
    const missing = required
      .filter(([permission]) => !permissions.has(permission))
      .map(([, label]) => label);
    if (missing.length)
      throw new ScheduleRefreshError(
        `Schedule channel <#${job.channel_id}> is missing: ${missing.join(", ")}.`,
        "schedule_channel_permissions",
      );

    // Validate and format the replacement before deleting the previous schedule.
    const response = runsResponseSchema.parse(
      await this.context.fullparty.getDiscordGuildUpcomingRuns(job.guild_id, {
        limit: 25,
      }),
    );
    if (
      response.meta?.discord_guild_id &&
      response.meta.discord_guild_id !== job.guild_id
    )
      throw new Error("FullParty returned a schedule for a different guild.");
    const message = createGuildUpcomingRunsPostMessage(
      response,
      this.context.fullpartyWebBaseUrl,
    );
    if (!canContinue()) return undefined;

    if (job.message_id && job.message_channel_id) {
      await this.deletePrevious(job, channel);
      this.store.clearMessage(job);
    }
    if (!canContinue()) return undefined;
    const sent = await channel.send({
      ...message,
      allowedMentions: { parse: [] },
      flags: MessageFlags.SuppressNotifications,
      nonce: createHash("sha256")
        .update(
          `${job.guild_id}:${String(job.revision)}:${job.last_refreshed_at ?? "initial"}`,
        )
        .digest("hex")
        .slice(0, 24),
      enforceNonce: true,
    });
    return sent.id;
  }

  private async getChannel(
    channelId: string,
    guildId: string,
  ): Promise<TextChannel | NewsChannel> {
    const channel = await this.client.channels.fetch(channelId);
    if (
      !channel ||
      (channel.type !== ChannelType.GuildText &&
        channel.type !== ChannelType.GuildAnnouncement) ||
      channel.guildId !== guildId
    ) {
      throw new ScheduleRefreshError(
        `Schedule channel <#${channelId}> is unavailable or is not a text channel in this server. Choose another channel in /setup.`,
        "schedule_channel_unavailable",
      );
    }
    return channel;
  }

  private async deletePrevious(
    job: ScheduleJob,
    destination: TextChannel | NewsChannel,
  ): Promise<void> {
    if (!job.message_id || !job.message_channel_id) return;
    try {
      const channel =
        destination.id === job.message_channel_id
          ? destination
          : await this.getChannel(job.message_channel_id, job.guild_id);
      const previous = await channel.messages.fetch({
        message: job.message_id,
        force: true,
        cache: false,
      });
      if (previous.author.id !== this.client.user?.id)
        throw new ScheduleRefreshError(
          "The tracked schedule message does not belong to this bot; it will not be deleted.",
          "schedule_message_owner_mismatch",
        );
      await previous.delete();
    } catch (error) {
      const code = getDiscordApiErrorCode(error);
      if (code === "10008" || code === "10003") return;
      throw error;
    }
  }
}
