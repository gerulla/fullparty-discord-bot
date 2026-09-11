import { describe, expect, it } from "vitest";
import {
  parseResourcePageControl,
  ResourcePaginationStore,
} from "../src/fullparty/resources/pagination.js";

describe("resource pagination sessions", () => {
  it("keeps long queries server-side with bounded, distinct custom IDs", () => {
    const store = new ResourcePaginationStore();
    const query = "a:".repeat(50);
    const id = store.create("guild", "user", query);
    const control = `info:next:${id}:2`;
    expect(control.length).toBeLessThanOrEqual(100);
    expect(control).not.toContain(query);
    expect(store.get(id)).toMatchObject({ guildId: "guild", requesterId: "user", query });
    expect(parseResourcePageControl(control)).toEqual({ sessionId: id, page: 2 });
    expect(store.create("guild", "user", query)).not.toBe(id);
  });
  it("expires and evicts sessions so the cache stays bounded", () => {
    let now = 0;
    const store = new ResourcePaginationStore(() => now, 100, 2);
    const first = store.create("guild", "user", null);
    const second = store.create("guild", "user", "drs");
    const third = store.create("guild", "user", "bridges");
    expect(store.get(first)).toBeUndefined();
    expect(store.get(second)).toBeDefined();
    now = 100;
    expect(store.get(second)).toBeUndefined();
    expect(store.get(third)).toBeUndefined();
  });
  it.each(["0", "-1", "1.5", "2:extra", "9007199254740992"])(
    "rejects invalid page %s",
    (page) => {
      expect(
        parseResourcePageControl(`info:next:${"a".repeat(24)}:${page}`),
      ).toBeUndefined();
    },
  );
});
