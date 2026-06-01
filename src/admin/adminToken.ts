import { randomBytes } from "node:crypto";

export type AdminApiToken = {
  source: "configured" | "generated";
  value: string;
};

export function createAdminApiToken(configuredToken?: string): AdminApiToken {
  if (configuredToken) {
    return {
      source: "configured",
      value: configuredToken,
    };
  }

  return {
    source: "generated",
    value: randomBytes(32).toString("base64url"),
  };
}
