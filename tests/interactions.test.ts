import { MessageFlags, SlashCommandBuilder, type Interaction } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BotContext } from "../src/bot/context.js";
import type { ChatInputCommand } from "../src/commands/types.js";
import { FullpartyApiClient, FullpartyApiError } from "../src/fullparty/client.js";
import {
  createAutomationFailureDetailsCustomId,
  storeAutomationFailureDetails,
} from "../src/guildAutomation/automationFailureDetails.js";
import { createInteractionHandler } from "../src/interactions/handleInteraction.js";
import { LatestPayloadStore } from "../src/payloads/latestPayloadStore.js";

describe("createInteractionHandler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it.each([{ code: 10062 }, { code: "10062" }, { rawError: { code: 10062 } }])(
    "does not try to respond again after Discord invalidates the interaction %j",
    async (details) => {
      const context = createContext();
      const reply = vi.fn();
      const editReply = vi.fn();
      const followUp = vi.fn();
      const error = Object.assign(new Error("Unknown interaction"), details);
      const command = createCommand("known", () => Promise.reject(error));
      const handler = createInteractionHandler(context, [command]);

      await expect(
        handler(createInteraction({ reply, editReply, followUp })),
      ).resolves.toBeUndefined();

      expect(reply).not.toHaveBeenCalled();
      expect(editReply).not.toHaveBeenCalled();
      expect(followUp).not.toHaveBeenCalled();
      expect(context.logCalls).toEqual([["error", "Command execution failed."]]);
    },
  );

  it("does not retry an invalidated component interaction", async () => {
    const context = createContext();
    const reply = vi.fn();
    const command = createCommand("known", () => Promise.resolve());
    const error = Object.assign(new Error("Unknown interaction"), { code: 10062 });
    command.componentCustomIdPrefix = "setup";
    command.handleComponent = () => Promise.reject(error);
    const handler = createInteractionHandler(context, [command]);

    await expect(handler(createComponentInteraction({ reply }))).resolves.toBeUndefined();
    expect(reply).not.toHaveBeenCalled();
    expect(context.logCalls).toEqual([["error", "Component interaction failed."]]);
  });

  it("keeps the original failure when an error reply encounters an expired interaction", async () => {
    const context = createContext();
    const replyError = Object.assign(new Error("Unknown interaction"), { code: 10062 });
    const reply = vi.fn(() => Promise.reject(replyError));
    const command = createCommand("known", () =>
      Promise.reject(new Error("Original failure")),
    );
    const handler = createInteractionHandler(context, [command]);

    await expect(handler(createInteraction({ reply }))).resolves.toBeUndefined();
    expect(reply).toHaveBeenCalledOnce();
    expect(context.logCalls).toEqual([
      ["error", "Command execution failed."],
      ["warn", "Interaction expired before the error reply could be sent."],
    ]);
  });

  it("still surfaces other error-reply failures", async () => {
    const context = createContext();
    const replyError = new Error("Network unavailable");
    const reply = vi.fn(() => Promise.reject(replyError));
    const command = createCommand("known", () =>
      Promise.reject(new Error("Original failure")),
    );
    const handler = createInteractionHandler(context, [command]);

    await expect(handler(createInteraction({ reply }))).rejects.toBe(replyError);
  });

  it("records interaction age separately from time spent in the handler", async () => {
    const context = createContext();
    const logError = vi.spyOn(context.logger, "error");
    const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const error = Object.assign(new Error("Unknown interaction"), { code: 10062 });
    const command = createCommand("known", () => {
      now.mockReturnValue(10_250);
      return Promise.reject(error);
    });
    const handler = createInteractionHandler(context, [command]);

    await handler(createInteraction({ createdTimestamp: 6000 }));

    expect(logError).toHaveBeenCalledWith("Command execution failed.", {
      commandName: "known",
      interactionId: "interaction-id",
      processId: process.pid,
      interactionAgeAtStartMs: 4000,
      interactionAgeAtFailureMs: 4250,
      handlerElapsedMs: 250,
      deferred: false,
      replied: false,
      error,
    });
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
            "The route api/integrations/v1/bot/discord-users/182/applications could not be found.",
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

  it("replies privately with automation failure details", async () => {
    const context = createContext();
    const reply = createAsyncRecorder();
    const detailsId = storeAutomationFailureDetails({
      context: "Run #123 - Cloud of Darkness",
      sections: [
        {
          details: [
            {
              reason: "Unknown Member",
              subject: "123",
            },
          ],
          title: "Role Assignment Failures",
        },
      ],
      title: "Role Assignment Failure Details",
    });
    const handler = createInteractionHandler(context, []);

    await handler(
      createComponentInteraction({
        customId: createAutomationFailureDetailsCustomId(detailsId ?? "missing"),
        reply: reply.fn,
      }),
    );

    expect(reply.calls).toEqual([
      [
        {
          allowedMentions: {
            parse: [],
          },
          content: expect.stringContaining("`123` - Unknown Member") as string,
          flags: MessageFlags.Ephemeral,
        },
      ],
    ]);
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
  createdTimestamp?: number;
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
    id: "interaction-id",
    createdTimestamp: options.createdTimestamp ?? Date.now(),
    deferred: options.deferred ?? false,
    editReply: options.editReply ?? editReply.fn,
    followUp: options.followUp ?? followUp.fn,
    isChatInputCommand: () => true,
    replied: options.replied ?? false,
    reply: options.reply ?? reply.fn,
    user: {
      id: "discord-user-id",
    },
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
    user: {
      id: "discord-user-id",
    },
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
