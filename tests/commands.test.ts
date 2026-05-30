import { ApplicationIntegrationType, InteractionContextType } from "discord.js";
import { describe, expect, it } from "vitest";

import { formatHealthResponse } from "../src/commands/fullparty.js";
import { getCommandData } from "../src/commands/index.js";

describe("commands", () => {
  it("registers command metadata for the intended install contexts", () => {
    const commands = getCommandData();

    expect(commands.map((command) => command.name)).toEqual([
      "applications",
      "help",
      "link",
      "ping",
      "payload",
      "runs",
      "setup",
    ]);

    const applications = commands.find((command) => command.name === "applications");
    const help = commands.find((command) => command.name === "help");
    const link = commands.find((command) => command.name === "link");
    const payload = commands.find((command) => command.name === "payload");
    const ping = commands.find((command) => command.name === "ping");
    const runs = commands.find((command) => command.name === "runs");
    const setup = commands.find((command) => command.name === "setup");

    expect(applications).toBeDefined();
    expect(help).toBeDefined();
    expect(link).toBeDefined();
    expect(payload).toBeDefined();
    expect(ping).toBeDefined();
    expect(runs).toBeDefined();
    expect(setup).toBeDefined();

    if (!applications || !help || !link || !payload || !ping || !runs || !setup) {
      throw new Error(
        "Expected applications, help, link, ping, payload, runs, and setup commands to be registered.",
      );
    }

    expect(ping.integration_types).toEqual(
      expect.arrayContaining([
        ApplicationIntegrationType.GuildInstall,
        ApplicationIntegrationType.UserInstall,
      ]),
    );
    expect(ping.contexts).toEqual(
      expect.arrayContaining([
        InteractionContextType.Guild,
        InteractionContextType.BotDM,
        InteractionContextType.PrivateChannel,
      ]),
    );
    expect(payload.integration_types).toEqual(
      expect.arrayContaining([
        ApplicationIntegrationType.GuildInstall,
        ApplicationIntegrationType.UserInstall,
      ]),
    );
    expect(payload.contexts).toEqual(
      expect.arrayContaining([
        InteractionContextType.Guild,
        InteractionContextType.BotDM,
        InteractionContextType.PrivateChannel,
      ]),
    );
    expect(applications.integration_types).toEqual(
      expect.arrayContaining([
        ApplicationIntegrationType.GuildInstall,
        ApplicationIntegrationType.UserInstall,
      ]),
    );
    expect(applications.contexts).toEqual([
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    ]);
    expect(help.integration_types).toEqual(
      expect.arrayContaining([
        ApplicationIntegrationType.GuildInstall,
        ApplicationIntegrationType.UserInstall,
      ]),
    );
    expect(help.contexts).toEqual([
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    ]);
    expect(link.integration_types).toEqual(
      expect.arrayContaining([
        ApplicationIntegrationType.GuildInstall,
        ApplicationIntegrationType.UserInstall,
      ]),
    );
    expect(link.contexts).toEqual([
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    ]);
    expect(link.options?.[0]).toMatchObject({
      name: "token",
      required: false,
    });
    expect(runs.integration_types).toEqual(
      expect.arrayContaining([
        ApplicationIntegrationType.GuildInstall,
        ApplicationIntegrationType.UserInstall,
      ]),
    );
    expect(runs.contexts).toEqual([
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    ]);
    expect(setup.integration_types).toEqual([ApplicationIntegrationType.GuildInstall]);
    expect(setup.contexts).toEqual([InteractionContextType.Guild]);
  });

  it("formats Fullparty health responses", () => {
    expect(formatHealthResponse({ status: "ok", version: "2026.05.29" })).toBe(
      "Fullparty API status: ok (2026.05.29)",
    );
    expect(formatHealthResponse({})).toBe("Fullparty API status: ok");
  });
});
