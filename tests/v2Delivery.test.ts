import { MessageFlags, type MessageCreateOptions } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { resolveV2MessageIcons } from "../src/discord/v2.js";
import { deliverStoredDm, sendUserDm } from "../src/dm/deliveryService.js";
import { dmDeliveryJobSchema } from "../src/dm/deliveryTypes.js";
import { SqliteDmQueueStore } from "../src/dm/queueStore.js";
import { UserDmRateLimiter } from "../src/dm/userDmRateLimiter.js";

function v2Message(): MessageCreateOptions {
  return {
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [], repliedUser: false },
    components: [
      {
        type: 17,
        accent_color: 0xa07ac7,
        components: [
          { type: 12, items: [{ media: { url: "https://fullparty.gg/banner.webp" } }] },
          {
            type: 9,
            components: [
              { type: 10, content: "## :fpcheck: Assigned\n<@123> @everyone" },
            ],
            accessory: { type: 11, media: { url: "https://fullparty.gg/group.webp" } },
          },
          { type: 14, divider: true, spacing: 2 },
          { type: 10, content: ":fpclock: Scheduled start" },
        ],
      },
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: "View Run",
            url: "https://fullparty.gg/en/runs/123",
          },
        ],
      },
    ],
  };
}

function dependencies() {
  const send = vi
    .fn<(message: MessageCreateOptions) => Promise<{ id: string }>>()
    .mockResolvedValue({ id: "message" });
  return {
    send,
    client: {
      users: { fetch: vi.fn(() => Promise.resolve({ send })) } as never,
      application: {
        emojis: { cache: new Map([["12345", { id: "12345", name: "fpcheck" }]]) },
      },
    },
    context: { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
  };
}

describe("V2 message delivery", () => {
  it("delivers nested components, V2 flags and no-ping policy through the normal DM path", async () => {
    const options = dependencies();
    const message = v2Message();
    await sendUserDm(options, "123", message, {
      notificationType: "assignments.assigned",
    });
    expect(options.send).toHaveBeenCalledOnce();
    const delivered = options.send.mock.calls[0]?.[0];
    expect(delivered).toEqual({
      ...resolveV2MessageIcons(message, options.client),
      nonce: expect.any(String) as string,
      enforceNonce: true,
    });
    expect(JSON.stringify(delivered)).toContain("<:fpcheck:12345>");
    expect(JSON.stringify(delivered)).toContain("🕒 Scheduled start");
    expect(JSON.stringify(message)).toContain(":fpcheck:");
  });

  it("round-trips V2 jobs through SQLite and the restored-job delivery path", async () => {
    const options = dependencies();
    const store = new SqliteDmQueueStore(":memory:");
    try {
      const message = v2Message();
      const job = dmDeliveryJobSchema.parse({
        discordUserId: "123",
        message,
        metadata: { notificationType: "assignments.assigned" },
      });
      store.enqueue(job);
      const restored = store.pending()[0]?.payload;
      expect(restored).toMatchObject(job);
      expect(restored?.message.flags).toBe(MessageFlags.IsComponentsV2);
      expect(restored?.message.allowedMentions).toEqual({
        parse: [],
        repliedUser: false,
      });
      if (!restored) throw new Error("Missing persisted job");
      await deliverStoredDm(options, restored);
      expect(options.send).toHaveBeenCalledWith(
        resolveV2MessageIcons(message, options.client),
      );
    } finally {
      store.close();
    }
  });

  it("keeps queued icon aliases until the emoji cache is ready at delivery", async () => {
    vi.useFakeTimers();
    const options = dependencies();
    options.client.application.emojis.cache.clear();
    const store = new SqliteDmQueueStore(":memory:");
    const limiter = new UserDmRateLimiter({
      store,
      logger: options.context.logger,
      startPaused: true,
    });
    try {
      await sendUserDm(
        { ...options, context: { ...options.context, userDmRateLimiter: limiter } },
        "123",
        v2Message(),
      );
      expect(options.send).not.toHaveBeenCalled();
      expect(JSON.stringify(store.pending()[0]?.payload.message)).toContain(":fpcheck:");

      options.client.application.emojis.cache.set("12345", {
        id: "12345",
        name: "fpcheck",
      });
      limiter.resume();
      await vi.advanceTimersByTimeAsync(0);
      expect(options.send).toHaveBeenCalledExactlyOnceWith({
        ...resolveV2MessageIcons(v2Message(), options.client),
        nonce: expect.any(String) as string,
        enforceNonce: true,
      });
      expect(store.pending()).toEqual([]);
    } finally {
      limiter.stop();
      store.close();
      vi.useRealTimers();
    }
  });

  it("leaves legacy embeds and link rows unchanged", () => {
    const message: MessageCreateOptions = {
      embeds: [
        { title: "Account updated", description: ":fpcheck: literal legacy text" },
      ],
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5,
              label: "View account",
              url: "https://fullparty.gg/account",
              emoji: { name: "🔗" },
            },
          ],
        },
      ],
    };
    expect(resolveV2MessageIcons(message, {})).toBe(message);
    expect(
      dmDeliveryJobSchema.parse({ discordUserId: "123", message, metadata: {} }).message,
    ).toEqual(message);
  });

  it("requires the V2 flag and forbids legacy content on a V2 message", () => {
    const message = v2Message();
    expect(
      dmDeliveryJobSchema.safeParse({
        discordUserId: "123",
        message: { ...message, flags: undefined },
        metadata: {},
      }).success,
    ).toBe(false);
    expect(
      dmDeliveryJobSchema.safeParse({
        discordUserId: "123",
        message: { ...message, content: "mixed" },
        metadata: {},
      }).success,
    ).toBe(false);
    expect(
      dmDeliveryJobSchema.safeParse({
        discordUserId: "123",
        message: { ...message, embeds: [] },
        metadata: {},
      }).success,
    ).toBe(false);
  });

  it("prefers application icons, preserves explicit markup, and bounds expanded text", () => {
    const message: MessageCreateOptions = {
      flags: 32768,
      components: [{ type: 10, content: ":fpcheck: ".repeat(390) + "<:fpcheck:98765>" }],
    };
    const source = {
      emojis: { cache: new Map([["1", { id: "11111", name: "fpcheck" }]]) },
      application: {
        emojis: {
          cache: new Map([["2", { id: "22222", name: "fpcheck", animated: true }]]),
        },
      },
    };
    const output = resolveV2MessageIcons(message, source);
    const component = output.components?.[0] as { type: 10; content: string };
    expect(component.content).toContain("<a:fpcheck:22222>");
    expect(component.content.length).toBeLessThanOrEqual(4000);
    const existing: MessageCreateOptions = {
      flags: MessageFlags.IsComponentsV2,
      components: [{ type: 10 as const, content: "<:fpcheck:98765> <a:fpcheck:98765>" }],
    };
    expect(resolveV2MessageIcons(existing, source)).toEqual(existing);
  });
});
