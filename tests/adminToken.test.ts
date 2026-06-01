import { describe, expect, it } from "vitest";

import { createAdminApiToken } from "../src/admin/adminToken.js";

describe("createAdminApiToken", () => {
  it("uses a configured token when provided", () => {
    expect(createAdminApiToken("configured-token")).toEqual({
      source: "configured",
      value: "configured-token",
    });
  });

  it("generates a fresh token when no configured token exists", () => {
    const firstToken = createAdminApiToken();
    const secondToken = createAdminApiToken();

    expect(firstToken).toMatchObject({
      source: "generated",
    });
    expect(firstToken.value).toMatch(/^[\w-]{40,}$/u);
    expect(secondToken.value).toMatch(/^[\w-]{40,}$/u);
    expect(firstToken.value).not.toBe(secondToken.value);
  });
});
