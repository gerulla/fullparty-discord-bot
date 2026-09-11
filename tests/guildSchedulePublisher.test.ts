import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  PermissionsBitField,
  type Client,
  type MessageCreateOptions,
} from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { FullpartyApiClient } from "../src/fullparty/client.js";
import { GuildSchedulePublisher } from "../src/guildSchedule/publisher.js";
import type { ScheduleJob } from "../src/guildSchedule/store.js";

function fixture() {
  const job: ScheduleJob = {
    guild_id: "guild",
    enabled: 1,
    channel_id: "channel",
    interval_days: 1,
    revision: 1,
    message_id: "old-message",
    message_channel_id: "channel",
    next_refresh_at: "2026-09-11T12:00:00Z",
    last_refreshed_at: "2026-09-10T12:00:00Z",
    last_attempt_at: null,
    last_error: null,
    linked_at: "2026-09-01T12:00:00Z",
  };
  const order: string[] = [];
  const previous = {
    author: { id: "bot" },
    delete: vi.fn(() => {
      order.push("delete");
      return Promise.resolve();
    }),
  };
  const history = vi.fn(() => Promise.resolve(previous));
  const send = vi.fn<(message: MessageCreateOptions) => Promise<{ id: string }>>(() => {
    order.push("send");
    return Promise.resolve({ id: "new-message" });
  });
  const channel = {
    id: "channel",
    guildId: "guild",
    type: ChannelType.GuildText,
    guild: { members: { me: { id: "bot" } } },
    permissionsFor: vi.fn(
      () =>
        new PermissionsBitField([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ]),
    ),
    messages: { fetch: history },
    send,
  };
  const fetchChannel = vi.fn<(id: string) => Promise<typeof channel>>(() =>
    Promise.resolve(channel),
  );
  const client = { user: { id: "bot" }, channels: { fetch: fetchChannel } };
  const fetcher = vi.fn<typeof fetch>(() => {
    order.push("fetch schedule");
    return Promise.resolve(
      Response.json({ data: [], meta: { discord_guild_id: "guild" } }),
    );
  });
  const clearMessage = vi.fn(() => {
    order.push("forget old");
  });
  const publisher = new GuildSchedulePublisher(
    client as unknown as Client,
    {
      fullparty: new FullpartyApiClient({ baseUrl: "https://fullparty.gg/api", fetcher }),
      fullpartyWebBaseUrl: "https://fullparty.gg",
    },
    { clearMessage },
  );
  return {
    job,
    order,
    previous,
    history,
    send,
    channel,
    fetchChannel,
    fetcher,
    clearMessage,
    publisher,
  };
}

describe("automatic schedule publishing", () => {
  it("fetches first, deletes only the tracked own post, then sends a fresh plain summary without pings", async () => {
    const f = fixture();
    await expect(f.publisher.replace(f.job, () => true)).resolves.toBe("new-message");
    expect(f.order).toEqual(["fetch schedule", "delete", "forget old", "send"]);
    expect(f.history).toHaveBeenCalledWith({
      message: "old-message",
      force: true,
      cache: false,
    });
    const sent = f.send.mock.calls[0]?.[0];
    expect(sent).toMatchObject({
      allowedMentions: { parse: [] },
      flags: MessageFlags.SuppressNotifications,
      enforceNonce: true,
    });
    expect(sent?.content).toContain("No upcoming");
    expect(sent).not.toHaveProperty("embeds");
    expect(sent).not.toHaveProperty("components");
    expect(sent?.nonce).toHaveLength(24);
  });

  it("does not delete anything on the first automatic post", async () => {
    const f = fixture();
    await f.publisher.replace(
      { ...f.job, message_id: null, message_channel_id: null },
      () => true,
    );
    expect(f.history).not.toHaveBeenCalled();
    expect(f.previous.delete).not.toHaveBeenCalled();
    expect(f.clearMessage).not.toHaveBeenCalled();
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it("uses the full existing /postruns formatter", async () => {
    const f = fixture();
    f.fetcher.mockImplementation(() =>
      Promise.resolve(
        Response.json({
          data: [
            {
              id: 1,
              title: "Prog Night",
              starts_at: "2026-09-12T18:00:00Z",
              counts: { assigned_slots: 2, total_slots: 8, total_applicants: 3 },
              group: { name: "Example", slug: "example" },
              host: { discord_user_id: "123456789012345678" },
              urls: { application: "/groups/example/activities/1/application" },
            },
          ],
        }),
      ),
    );
    await f.publisher.replace(f.job, () => true);
    const sent = f.send.mock.calls[0]?.[0];
    expect(sent?.content).toContain("**Prog Night**");
    expect(sent?.content).toContain("2/8 Participants - 3 Applications");
    expect(sent?.content).toContain("<t:");
    expect(sent?.content).toContain("<@123456789012345678>");
    expect(sent?.content).toContain(
      "[Apply Here](<https://fullparty.gg/groups/example/activities/1/application>)",
    );
  });

  it.each(["outage", "malformed", "wrong guild"])(
    "keeps the old schedule if the API response is %s",
    async (reason) => {
      const f = fixture();
      f.fetcher.mockImplementation(() =>
        Promise.resolve(
          reason === "outage"
            ? Response.json({}, { status: 503 })
            : Response.json(
                reason === "malformed"
                  ? { message: "bad response" }
                  : { data: [], meta: { discord_guild_id: "other" } },
              ),
        ),
      );
      await expect(f.publisher.replace(f.job, () => true)).rejects.toThrow();
      expect(f.previous.delete).not.toHaveBeenCalled();
      expect(f.send).not.toHaveBeenCalled();
    },
  );

  it("does not fetch or delete the previous post when destination permissions are missing", async () => {
    const f = fixture();
    f.channel.permissionsFor.mockReturnValue(
      new PermissionsBitField(PermissionFlagsBits.ViewChannel),
    );
    await expect(f.publisher.replace(f.job, () => true)).rejects.toMatchObject({
      code: "schedule_channel_permissions",
    });
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.previous.delete).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });

  it("refuses to delete a tracked message belonging to another author", async () => {
    const f = fixture();
    f.previous.author.id = "someone-else";
    await expect(f.publisher.replace(f.job, () => true)).rejects.toMatchObject({
      code: "schedule_message_owner_mismatch",
    });
    expect(f.previous.delete).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });

  it("recreates a manually deleted automatic post", async () => {
    const f = fixture();
    f.history.mockRejectedValue({ code: 10008 });
    await expect(f.publisher.replace(f.job, () => true)).resolves.toBe("new-message");
    expect(f.clearMessage).toHaveBeenCalled();
  });

  it("does not pile up new posts when deleting the old post fails", async () => {
    const f = fixture();
    f.previous.delete.mockRejectedValue({ code: 50013 });
    await expect(f.publisher.replace(f.job, () => true)).rejects.toMatchObject({
      code: 50013,
    });
    expect(f.clearMessage).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });

  it("deletes the tracked post from its original channel after the destination changes", async () => {
    const f = fixture();
    const oldChannel = { ...f.channel, id: "old-channel" };
    f.fetchChannel.mockImplementation((id) =>
      Promise.resolve(id === "old-channel" ? oldChannel : f.channel),
    );
    await f.publisher.replace(
      { ...f.job, message_channel_id: "old-channel" },
      () => true,
    );
    expect(f.fetchChannel).toHaveBeenCalledWith("old-channel");
    expect(f.previous.delete).toHaveBeenCalledTimes(1);
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it("stops before deletion if settings changed while fetching", async () => {
    const f = fixture();
    await expect(f.publisher.replace(f.job, () => false)).resolves.toBeUndefined();
    expect(f.previous.delete).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });

  it("keeps the deletion recorded when sending a replacement fails", async () => {
    const f = fixture();
    f.send.mockRejectedValue({ code: 50013 });
    await expect(f.publisher.replace(f.job, () => true)).rejects.toMatchObject({
      code: 50013,
    });
    expect(f.clearMessage).toHaveBeenCalledWith(f.job);
  });

  it("rejects a destination from another guild before any destructive action", async () => {
    const f = fixture();
    f.channel.guildId = "another-guild";
    await expect(f.publisher.replace(f.job, () => true)).rejects.toMatchObject({
      code: "schedule_channel_unavailable",
    });
    expect(f.previous.delete).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
});
