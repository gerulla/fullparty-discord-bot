import type { DatabaseSync } from "node:sqlite";
import type { AdminStore } from "../shared/telemetry.js";
import { migrateAdminDatabase } from "./migrations.js";
import { AdminGuildQueries } from "./store/guildQueries.js";
import { AdminMetricsQueries } from "./store/metricsQueries.js";
import { AdminRecordQueries } from "./store/recordQueries.js";
import { AdminTelemetryWriter } from "./store/telemetryWriter.js";

export class SqliteAdminStore implements AdminStore {
  private readonly adminTelemetryWriter: AdminTelemetryWriter;
  private readonly adminRecordQueries: AdminRecordQueries;
  private readonly adminMetricsQueries: AdminMetricsQueries;
  private readonly adminGuildQueries: AdminGuildQueries;
  public constructor(private readonly database: DatabaseSync) {
    migrateAdminDatabase(database);
    this.adminTelemetryWriter = new AdminTelemetryWriter(database);
    this.adminRecordQueries = new AdminRecordQueries(database);
    this.adminMetricsQueries = new AdminMetricsQueries(database);
    this.adminGuildQueries = new AdminGuildQueries(
      database,
      this.adminRecordQueries,
      this.adminMetricsQueries,
    );
  }
  public recordBotEvent(
    ...args: Parameters<AdminTelemetryWriter["recordBotEvent"]>
  ): ReturnType<AdminTelemetryWriter["recordBotEvent"]> {
    return this.adminTelemetryWriter.recordBotEvent(...args);
  }
  public recordDmDelivery(
    ...args: Parameters<AdminTelemetryWriter["recordDmDelivery"]>
  ): ReturnType<AdminTelemetryWriter["recordDmDelivery"]> {
    return this.adminTelemetryWriter.recordDmDelivery(...args);
  }
  public recordCommandUsage(
    ...args: Parameters<AdminTelemetryWriter["recordCommandUsage"]>
  ): ReturnType<AdminTelemetryWriter["recordCommandUsage"]> {
    return this.adminTelemetryWriter.recordCommandUsage(...args);
  }
  public recordGuildMessage(
    ...args: Parameters<AdminTelemetryWriter["recordGuildMessage"]>
  ): ReturnType<AdminTelemetryWriter["recordGuildMessage"]> {
    return this.adminTelemetryWriter.recordGuildMessage(...args);
  }
  public recordGuildRuntime(
    ...args: Parameters<AdminTelemetryWriter["recordGuildRuntime"]>
  ): ReturnType<AdminTelemetryWriter["recordGuildRuntime"]> {
    return this.adminTelemetryWriter.recordGuildRuntime(...args);
  }
  public recordAutomationRun(
    ...args: Parameters<AdminTelemetryWriter["recordAutomationRun"]>
  ): ReturnType<AdminTelemetryWriter["recordAutomationRun"]> {
    return this.adminTelemetryWriter.recordAutomationRun(...args);
  }
  public getEvents(
    ...args: Parameters<AdminRecordQueries["getEvents"]>
  ): ReturnType<AdminRecordQueries["getEvents"]> {
    return this.adminRecordQueries.getEvents(...args);
  }
  public getDmDeliveries(
    ...args: Parameters<AdminRecordQueries["getDmDeliveries"]>
  ): ReturnType<AdminRecordQueries["getDmDeliveries"]> {
    return this.adminRecordQueries.getDmDeliveries(...args);
  }
  public getCommandUsages(
    ...args: Parameters<AdminRecordQueries["getCommandUsages"]>
  ): ReturnType<AdminRecordQueries["getCommandUsages"]> {
    return this.adminRecordQueries.getCommandUsages(...args);
  }
  public getGuildMessages(
    ...args: Parameters<AdminRecordQueries["getGuildMessages"]>
  ): ReturnType<AdminRecordQueries["getGuildMessages"]> {
    return this.adminRecordQueries.getGuildMessages(...args);
  }
  public getAutomationRuns(
    ...args: Parameters<AdminRecordQueries["getAutomationRuns"]>
  ): ReturnType<AdminRecordQueries["getAutomationRuns"]> {
    return this.adminRecordQueries.getAutomationRuns(...args);
  }
  public getFailures(
    ...args: Parameters<AdminRecordQueries["getFailures"]>
  ): ReturnType<AdminRecordQueries["getFailures"]> {
    return this.adminRecordQueries.getFailures(...args);
  }
  public getGuilds(
    ...args: Parameters<AdminRecordQueries["getGuilds"]>
  ): ReturnType<AdminRecordQueries["getGuilds"]> {
    return this.adminRecordQueries.getGuilds(...args);
  }
  public getQueueSummary(
    ...args: Parameters<AdminRecordQueries["getQueueSummary"]>
  ): ReturnType<AdminRecordQueries["getQueueSummary"]> {
    return this.adminRecordQueries.getQueueSummary(...args);
  }
  public getSummary(
    ...args: Parameters<AdminMetricsQueries["getSummary"]>
  ): ReturnType<AdminMetricsQueries["getSummary"]> {
    return this.adminMetricsQueries.getSummary(...args);
  }
  public getDashboardMetrics(
    ...args: Parameters<AdminMetricsQueries["getDashboardMetrics"]>
  ): ReturnType<AdminMetricsQueries["getDashboardMetrics"]> {
    return this.adminMetricsQueries.getDashboardMetrics(...args);
  }
  public getGuildDashboards(
    ...args: Parameters<AdminGuildQueries["getGuildDashboards"]>
  ): ReturnType<AdminGuildQueries["getGuildDashboards"]> {
    return this.adminGuildQueries.getGuildDashboards(...args);
  }
  public close(): void {
    this.database.close();
  }
}
