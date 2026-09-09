import { handleAdminApiRequest as handleRequest } from "@fullparty/admin";
import type { HealthSnapshot } from "@fullparty/admin/contracts";
import type { Client } from "discord.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { BotContext } from "../bot/context.js";

type AdminIntegrationOptions = {
  adminApiToken?: string | undefined;
  client: Client;
  context: BotContext;
  createHealth(): Promise<HealthSnapshot>;
};

export function handleAdminApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: AdminIntegrationOptions,
): Promise<boolean> {
  const { context } = options;
  const scheduler = context.guildMemberCacheScheduler;
  return handleRequest(request, response, url, {
    adminApiToken: options.adminApiToken,
    store: context.adminStore,
    createHealth: () => options.createHealth(),
    getUserDmQueues: () => context.userDmRateLimiter?.getQueueSnapshot() ?? [],
    runtimeLogs: context.runtimeLogs,
    refreshMemberCache: scheduler
      ? () => scheduler.refreshLinkedGuildsFromDashboard()
      : undefined,
    async refreshGuildRuntime() {
      for (const guild of options.client.guilds.cache.values()) {
        const settings = await context.guildSettings.get(guild.id);
        await context.adminStore?.recordGuildRuntime({
          botPermissions: guild.members.me?.permissions.bitfield.toString() ?? null,
          discordGuildId: guild.id,
          linkedAt: settings.linkedAt ?? null,
          memberCount: typeof guild.memberCount === "number" ? guild.memberCount : null,
          name: guild.name,
          unavailable: !guild.available,
        });
      }
    },
  });
}
