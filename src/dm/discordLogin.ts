import { z } from "zod";
import {
  createDiscordLoginWelcomeMessage,
  type LinkV2Message,
} from "../discord/linkMessages.js";

export const discordLoginEvent = "user.discord_login";

export const discordLoginDataSchema = z.looseObject({
  user: z.looseObject({
    id: z.number().int().positive(),
    name: z.string().trim().min(1),
  }),
  discord_user_id: z
    .string()
    .trim()
    .regex(/^[1-9]\d{16,19}$/u),
  locale: z.string().trim().min(1).optional(),
  discord_app_install_url: z.string().trim().min(1).max(512).refine(isInstallUrl, {
    message: "Must be an absolute HTTP(S) URL without credentials.",
  }),
  discord_app_installed: z.boolean(),
  account_settings_url: z.string().nullable().optional(),
});

export function createDiscordLoginMessage(
  installUrl?: string,
  fullpartyWebBaseUrl = "https://fullparty.gg",
  accountSettingsUrl?: unknown,
): LinkV2Message {
  return createDiscordLoginWelcomeMessage({
    fullpartyWebBaseUrl,
    installUrl,
    accountSettingsUrl,
  });
}

function isInstallUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
