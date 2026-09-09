import { handleAdminApiRequest, SqliteAdminStore } from "@fullparty/admin";
import {
  dashboardResponseSchema,
  runtimeLogsResponseSchema,
} from "@fullparty/admin/schemas";
import { once } from "node:events";
import { createServer } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { openSqliteDatabase } from "../src/database/sqlite.js";

describe("bot/admin contract", () => {
  it("serves real SQLite metrics that satisfy the frontend contract", async () => {
    const database = openSqliteDatabase(":memory:");
    const store = new SqliteAdminStore(database);
    const refreshGuildRuntime = vi.fn(() => Promise.resolve());
    await store.recordGuildRuntime({
      discordGuildId: "guild-1",
      name: "Contract Test",
      memberCount: 48,
      botPermissions: "8",
    });
    await store.recordBotEvent({
      discordGuildId: "guild-1",
      eventType: "discord.guild.run_reminder",
      status: "accepted",
    });
    await store.recordDmDelivery({
      discordUserId: "user-1",
      notificationType: "runs.starting_soon",
      status: "sent",
    });
    const server = createServer((request, response) => {
      void handleAdminApiRequest(
        request,
        response,
        new URL(request.url ?? "/", "http://localhost"),
        {
          store,
          adminApiToken: "test-token",
          refreshGuildRuntime,
          createHealth: () =>
            Promise.resolve({
              status: "healthy",
              ok: true,
              checks: {},
              timestamp: new Date().toISOString(),
              uptime_seconds: 1,
            }),
          getUserDmQueues: () => [],
        },
      ).catch(() => {
        response.writeHead(500);
        response.end();
      });
    });
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing port");
      const base = `http://127.0.0.1:${String(address.port)}/admin/api/`;
      const headers = { authorization: "Bearer test-token" };
      expect((await fetch(`${base}metrics`)).status).toBe(401);
      const metrics = dashboardResponseSchema.parse(
        await (await fetch(`${base}metrics`, { headers })).json(),
      );
      expect(metrics.data.guilds.total).toBe(1);
      expect(metrics.data.metrics.totals.events24h).toBe(1);
      expect(metrics.data.metrics.totals.dmsSent24h).toBe(1);
      const logs = runtimeLogsResponseSchema.parse(
        await (await fetch(`${base}logs`, { headers })).json(),
      );
      expect(logs.data).toEqual([]);
      expect(refreshGuildRuntime).toHaveBeenCalledTimes(1);
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
      store.close();
    }
  });
});
