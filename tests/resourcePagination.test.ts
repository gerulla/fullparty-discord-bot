import { describe, expect, it } from "vitest";
import {
  parseResourcePageControl,
  parseResourceShowControl,
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
  it("keeps Show names server-side and replaces the snapshot when paging", () => {
    const store = new ResourcePaginationStore();
    const id = store.create("guild", "user", null);
    const names = ["long:name".repeat(10), "Second resource"];
    store.setPage(id, 1, names);
    names[0] = "Changed externally";
    const control = `info:show:${id}:1:0`;
    expect(control.length).toBeLessThanOrEqual(100);
    expect(parseResourceShowControl(control)).toEqual({
      sessionId: id,
      page: 1,
      index: 0,
    });
    expect(store.get(id)).toMatchObject({
      currentPage: 1,
      commandNames: ["long:name".repeat(10), "Second resource"],
    });
    store.setPage(id, 2, ["Another resource"]);
    expect(store.get(id)).toMatchObject({
      currentPage: 2,
      commandNames: ["Another resource"],
    });
  });
  it("allows one active post per list, retries after failure, and retires successful lists", () => {
    let now = 0;
    const store = new ResourcePaginationStore(() => now, 100);
    const id = store.create("guild", "user", null);
    expect(store.beginPost(id)).toBe(true);
    expect(store.beginPost(id)).toBe(false);
    store.releasePost(id);
    expect(store.beginPost(id)).toBe(true);
    store.delete(id);
    store.releasePost(id);
    expect(store.get(id)).toBeUndefined();
    expect(store.beginPost(id)).toBe(false);

    const expired = store.create("guild", "user", null);
    now = 100;
    expect(store.beginPost(expired)).toBe(false);
  });
  it.each(["0:0", "-1:0", "1:-1", "1:1.5", "1:0:extra", "1:9007199254740992"])(
    "rejects malformed Show controls %s",
    (suffix) => {
      expect(
        parseResourceShowControl(`info:show:${"a".repeat(24)}:${suffix}`),
      ).toBeUndefined();
    },
  );
  it.each(["0", "-1", "1.5", "2:extra", "9007199254740992"])(
    "rejects invalid page %s",
    (page) => {
      expect(
        parseResourcePageControl(`info:next:${"a".repeat(24)}:${page}`),
      ).toBeUndefined();
    },
  );
});
