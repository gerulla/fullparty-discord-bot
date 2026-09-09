import type { Client } from "discord.js";
import type { BotContext } from "../bot/context.js";

export type WebhookServerOptions = {
  adminApiToken?: string | undefined;
  adminUiRoot?: string | undefined;
  client: Client;
  context: BotContext;
  fullpartyWebBaseUrl: string;
  host: string;
  maxBodyBytes?: number;
  port: number;
  signatureToleranceSeconds?: number;
  webhookSigningSecret: string;
};

export type ActionResult = Record<string, unknown>;
