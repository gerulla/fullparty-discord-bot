import { MessageFlags, SlashCommandBuilder, type Interaction } from "discord.js";
import { describe, expect, it } from "vitest";

import type { BotContext } from "../src/bot/context.js";
import { createInteractionHandler } from "../src/interactions/handleInteraction.js";
import type { ChatInputCommand } from "../src/commands/types.js";
import { FullpartyApiClient, FullpartyApiError } from "../src/fullparty/client.js";
import { LatestPayloadStore } from "../src/payloads/latestPayloadStore.js";

describe("createInteractionHandler", () => {
  it("ignores non-chat-input interactions", async () => {
    const context = createContext();
    const handler = createInteractionHandler(context);

    await handler({
      isChatInputCommand: () => false,
    } as unknown as Interaction);

    expect(context.logCalls).toEqual([]);
  });

  it("executes a matching command", async () => {
    const context = createContext();
    let executed = false;
    const command = createCommand("known", () => {
      executed = true;
      return Promise.resolve();
    });
    const handler = createInteractionHandler(context, [command]);

    await handler(createInteraction({ commandName: "known" }));

    expect(executed).toBe(true);
  });

  it("replies to unknown commands", async () => {
    const context = createContext();
    const reply = createAsyncRecorder();
    const handler = createInteractionHandler(context, []);

    await handler(
      createInteraction({
        commandName: "missing",
        reply: reply.fn,
      }),
    );

    expect(context.logCalls).toEqual([
      ["warn", "Received an unknown command interaction."],
    ]);
    expect(reply.calls).toEqual([
      [
        {
          content: "That command is not available.",
          flags: MessageFlags.Ephemeral,
        },
      ],
    ]);
  });

  it("replies with an error when an initial command response fails", async () => {
    const context = createContext();
    const reply = createAsyncRecorder();
    const command = createCommand("known", () => Promise.reject(new Error("boom")));
    const handler = createInteractionHandler(context, [command]);

    await handler(
      createInteraction({
        commandName: "known",
        reply: reply.fn,
      }),
    );

    expect(reply.calls).toEqual([
      [
        {
          content: "Something went wrong while running that command.",
          flags: MessageFlags.Ephemeral,
        },
      ],
    ]);
  });

  it("tells unlinked users to connect their account", async () => {
    const context = createContext();
    const reply = createAsyncRecorder();
    const command = createCommand("known", () =>
      Promise.reject(
        new FullpartyApiError("Discord user is not linked.", 404, {
          error: "discord_user_not_linked",
          message: "Discord user is not linked to FullParty.",
        }),
      ),
    );
    const handler = createInteractionHandler(context, [command]);

    await handler(
      createInteraction({
        commandName: "known",
        reply: reply.fn,
      }),
    );

    expect(reply.calls).toEqual([
      [
        {
          content:
            "Your Discord account is not linked to FullParty yet.\n\nOpen https://fullparty.gg, go to your user settings, and generate a Discord link code.\n\nThen come back here and run `/link token:<code>` to connect your account.",
          flags: MessageFlags.Ephemeral,
        },
      ],
    ]);
  });

  it("recognizes Laravel-style missing linked Discord user errors", async () => {
    const context = createContext();
    const reply = createAsyncRecorder();
    const command = createCommand("known", () =>
      Promise.reject(
        new FullpartyApiError("Fullparty API request failed with status 404", 404, {
          message: "Linked Discord user could not be found.",
        }),
      ),
    );
    const handler = createInteractionHandler(context, [command]);

    await handler(
      createInteraction({
        commandName: "known",
        reply: reply.fn,
      }),
    );

    expect(reply.calls).toEqual([
      [
        {
          content:
            "Your Discord account is not linked to FullParty yet.\n\nOpen https://fullparty.gg, go to your user settings, and generate a Discord link code.\n\nThen come back here and run `/link token:<code>` to connect your account.",
          flags: MessageFlags.Ephemeral,
        },
      ],
    ]);
  });

  it("does not treat missing FullParty routes as unlinked accounts", async () => {
    const context = createContext();
    const reply = createAsyncRecorder();
    const command = createCommand("known", () =>
      Promise.reject(
        new FullpartyApiError("Fullparty API request failed with status 404", 404, {
          message:
            "The route api/integrations/discord-users/182/applications could not be found.",
        }),
      ),
    );
    const handler = createInteractionHandler(context, [command]);

    await handler(
      createInteraction({
        commandName: "known",
        reply: reply.fn,
      }),
    );

    expect(reply.calls).toEqual([
      [
        {
          content: "Something went wrong while running that command.",
          flags: MessageFlags.Ephemeral,
        },
      ],
    ]);
  });

  it("edits a deferred response when a command fails after deferring", async () => {
    const context = createContext();
    const editReply = createAsyncRecorder();
    const command = createCommand("known", () => Promise.reject(new Error("boom")));
    const handler = createInteractionHandler(context, [command]);

    await handler(
      createInteraction({
        commandName: "known",
        deferred: true,
        editReply: editReply.fn,
      }),
    );

    expect(editReply.calls).toEqual([
      [{ content: "Something went wrong while running that command." }],
    ]);
  });

  it("follows up when a replied command later fails", async () => {
    const context = createContext();
    const followUp = createAsyncRecorder();
    const command = createCommand("known", () => Promise.reject(new Error("boom")));
    const handler = createInteractionHandler(context, [command]);

    await handler(
      createInteraction({
        commandName: "known",
        followUp: followUp.fn,
        replied: true,
      }),
    );

    expect(followUp.calls).toEqual([
      [
        {
          content: "Something went wrong while running that command.",
          flags: MessageFlags.Ephemeral,
        },
      ],
    ]);
  });

  it("executes matching component interactions", async () => {
    const context = createContext();
    let executed = false;
    const command = createCommand("known", () => Promise.resolve());
    command.componentCustomIdPrefix = "setup";
    command.handleComponent = () => {
      executed = true;
      return Promise.resolve();
    };
    const handler = createInteractionHandler(context, [command]);

    await handler(createComponentInteraction({ customId: "setup:bot_log_channel" }));

    expect(executed).toBe(true);
  });

  it("replies to unknown component interactions", async () => {
    const context = createContext();
    const reply = createAsyncRecorder();
    const handler = createInteractionHandler(context, []);

    await handler(
      createComponentInteraction({
        customId: "setup:missing",
        reply: reply.fn,
      }),
    );

    expect(context.logCalls).toEqual([
      ["warn", "Received an unknown component interaction."],
    ]);
    expect(reply.calls).toEqual([
      [
        {
          content: "That setup control is no longer available.",
          flags: MessageFlags.Ephemeral,
        },
      ],
    ]);
  });
});

type TestContext = BotContext & {
  logCalls: string[][];
};

type FakeInteractionOptions = {
  commandName?: string;
  customId?: string;
  deferred?: boolean;
  editReply?: (...args: unknown[]) => Promise<void>;
  followUp?: (...args: unknown[]) => Promise<void>;
  replied?: boolean;
  reply?: (...args: unknown[]) => Promise<void>;
};

function createContext(): TestContext {
  const logCalls: string[][] = [];

  return {
    fullparty: new FullpartyApiClient({
      baseUrl: "https://api.fullparty.gg",
      fetcher: () => Promise.resolve(new Response(null, { status: 204 })),
    }),
    fullpartyWebBaseUrl: "https://fullparty.gg",
    guildSettings: {
      get: (guildId) => Promise.resolve({ guildId, syncDiscordNamesToFf14: false }),
      update: (guildId) => Promise.resolve({ guildId, syncDiscordNamesToFf14: false }),
    },
    logCalls,
    logger: {
      debug: (message) => {
        logCalls.push(["debug", message]);
      },
      error: (message) => {
        logCalls.push(["error", message]);
      },
      info: (message) => {
        logCalls.push(["info", message]);
      },
      warn: (message) => {
        logCalls.push(["warn", message]);
      },
    },
    payloads: new LatestPayloadStore(),
  };
}

function createCommand(
  name: string,
  execute: ChatInputCommand["execute"],
): ChatInputCommand {
  return {
    data: new SlashCommandBuilder().setName(name).setDescription(`${name} command`),
    execute,
  };
}

function createInteraction(options: FakeInteractionOptions = {}): Interaction {
  const reply = createAsyncRecorder();
  const editReply = createAsyncRecorder();
  const followUp = createAsyncRecorder();

  return {
    commandName: options.commandName ?? "known",
    deferred: options.deferred ?? false,
    editReply: options.editReply ?? editReply.fn,
    followUp: options.followUp ?? followUp.fn,
    isChatInputCommand: () => true,
    replied: options.replied ?? false,
    reply: options.reply ?? reply.fn,
  } as unknown as Interaction;
}

function createComponentInteraction(options: FakeInteractionOptions = {}): Interaction {
  const reply = createAsyncRecorder();
  const editReply = createAsyncRecorder();
  const followUp = createAsyncRecorder();

  return {
    customId: options.customId ?? "setup:known",
    deferred: options.deferred ?? false,
    editReply: options.editReply ?? editReply.fn,
    followUp: options.followUp ?? followUp.fn,
    isButton: () => true,
    isChannelSelectMenu: () => false,
    isChatInputCommand: () => false,
    isRoleSelectMenu: () => false,
    replied: options.replied ?? false,
    reply: options.reply ?? reply.fn,
  } as unknown as Interaction;
}

function createAsyncRecorder(): {
  calls: unknown[][];
  fn: (...args: unknown[]) => Promise<void>;
} {
  const calls: unknown[][] = [];

  return {
    calls,
    fn: (...args) => {
      calls.push(args);
      return Promise.resolve();
    },
  };
}
