import type {
  AdminAutomationRunInput,
  AdminBotEventInput,
  AdminDmDeliveryInput,
  AdminGuildMessageInput,
  AdminStore,
} from "@fullparty/admin";
import type { BotContext } from "../bot/context.js";
import { bestEffort } from "../lib/bestEffort.js";

export function recordAdminBotEvent(
  store: AdminStore | undefined,
  logger: BotContext["logger"],
  input: AdminBotEventInput,
): void {
  bestEffort(logger, "Unable to record admin bot event telemetry.", () =>
    store?.recordBotEvent(input),
  );
}

export function recordAdminDmDelivery(
  store: AdminStore | undefined,
  logger: BotContext["logger"],
  input: AdminDmDeliveryInput,
): void {
  bestEffort(logger, "Unable to record admin DM telemetry.", () =>
    store?.recordDmDelivery(input),
  );
}

export function recordAdminAutomationRun(
  store: AdminStore | undefined,
  logger: BotContext["logger"],
  input: AdminAutomationRunInput,
): void {
  bestEffort(logger, "Unable to record admin automation telemetry.", () =>
    store?.recordAutomationRun(input),
  );
}

export function recordAdminGuildMessage(
  store: AdminStore | undefined,
  logger: BotContext["logger"],
  input: AdminGuildMessageInput,
): void {
  bestEffort(logger, "Unable to record admin guild message telemetry.", () =>
    store?.recordGuildMessage(input),
  );
}
