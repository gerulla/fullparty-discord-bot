import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { createVersionStore } from "./store.mjs";
import { createPreviewServer } from "./server.mjs";
import {
  assertDraft,
  validateMessage,
  newComponent,
  assignSourceKeys,
  sourceKey,
  isV2,
  createV2Message,
  normalizeMessage,
} from "./model.mjs";
import { createRenderer } from "./renderer.mjs";

const draft = (name = "Option A") => ({
  sourceKey: "example::assigned",
  sourceTitle: "Assignment confirmed",
  name,
  message: { content: "Your place is confirmed.", future_field: { retained: true } },
  preview: { audience: "Only you" },
  assets: [{ name: "sample.png", dataUrl: "data:image/png;base64,aGVsbG8=" }],
});

test("export normalization omits blank media alt text without altering the draft or other fields", () => {
  const gallery = {
    type: 12,
    items: [
      { media: { url: "https://example.com/banner.png" }, description: "" },
      { media: { url: "https://example.com/other.png" }, description: "  Banner  " },
    ],
  };
  const section = {
    type: 9,
    components: [{ type: 10, content: "# Run confirmed\n" }],
    accessory: {
      type: 11,
      media: { url: "https://example.com/host.png" },
      description: " \n ",
    },
  };
  const message = {
    flags: 32768,
    components: [
      { type: 17, accent_color: 0, spoiler: false, components: [gallery, section] },
    ],
    future_field: { description: "", enabled: false },
  };
  const before = JSON.stringify(message);
  const exported = normalizeMessage(message);
  assert.equal(JSON.stringify(message), before);
  assert.deepEqual(exported, {
    ...message,
    components: [
      {
        ...message.components[0],
        components: [
          { ...gallery, items: [{ media: gallery.items[0].media }, gallery.items[1]] },
          { ...section, accessory: { type: 11, media: section.accessory.media } },
        ],
      },
    ],
  });
  assert.deepEqual(normalizeMessage(exported), exported);
  assert.deepEqual(validateMessage(exported), []);

  section.accessory.description = "a".repeat(1024);
  gallery.items[0].description = "b".repeat(1024);
  assert.deepEqual(normalizeMessage(message), message);
  assert.deepEqual(validateMessage(message), []);
  section.accessory.description += "a";
  gallery.items[0].description += "b";
  const issues = validateMessage(message).join("\n");
  assert.match(issues, /Thumbnail description.*1025 \/ 1024/);
  assert.match(issues, /Gallery media description.*1025 \/ 1024/);
});

test("V2 starters retain response content and controls without mutating the original", () => {
  const original = {
    content: "Hello <@123>",
    flags: 64 | 4,
    embeds: [
      {
        title: "Run confirmed",
        url: "https://fullparty.gg/runs/123",
        color: 0,
        author: { name: "FullParty" },
        description: "Ready to go.",
        thumbnail: { url: "https://example.com/thumb.png" },
        image: { url: "attachment://banner.png" },
        fields: [{ name: "Start", value: "19:00", inline: true }],
        footer: { text: "Your party" },
        timestamp: "2026-10-16T18:00:00Z",
      },
    ],
    components: [{ type: 1, components: [newComponent(2)] }],
    files: [{ name: "banner.png", attachment: "attachment://banner.png" }],
    poll: { question: { text: "When?" } },
    stickers: ["123"],
    future_field: { keep: true },
  };
  const before = JSON.stringify(original);
  const converted = createV2Message(original);
  assert.equal(JSON.stringify(original), before);
  assert.ok(isV2(converted));
  assert.ok(converted.flags & 64);
  assert.equal(converted.flags & 4, 0);
  for (const field of ["content", "embeds", "poll", "stickers"])
    assert.equal(converted[field], undefined);
  assert.deepEqual(converted.allowedMentions, { parse: [], repliedUser: false });
  const container = converted.components.find((c) => c.type === 17);
  assert.equal(container.accent_color, 0);
  assert.equal(container.components[0].accessory.type, 11);
  assert.match(JSON.stringify(container), /Run confirmed/);
  assert.match(JSON.stringify(container), /19:00/);
  assert.match(JSON.stringify(container), /Your party/);
  assert.deepEqual(
    converted.components.find((c) => c.type === 1),
    original.components[0],
  );
  assert.deepEqual(converted.future_field, { keep: true });
  assert.deepEqual(validateMessage(converted), []);
  converted.components.find((c) => c.type === 1).components[0].label = "Changed";
  assert.equal(JSON.stringify(original), before);
});

test("existing V2 layouts round-trip and empty originals get an editable starter", async (t) => {
  const original = {
    flags: 32768,
    components: [newComponent(17)],
    allowedMentions: { roles: ["123"] },
  };
  const converted = createV2Message(original);
  assert.deepEqual(converted, original);
  assert.notEqual(converted, original);
  assert.deepEqual(validateMessage(createV2Message({})), []);
  const { path } = await fixture(t);
  const saved = await createVersionStore(path).save({
    ...draft("V2 option"),
    message: converted,
  });
  const reopened = (await createVersionStore(path).list()).versions[0];
  assert.ok(isV2(reopened.message));
  assert.deepEqual(reopened, saved);
});
async function fixture(t) {
  const parent = resolve(tmpdir());
  const directory = await mkdtemp(join(parent, "fullparty-workshop-test-"));
  t.after(async () => {
    const target = resolve(directory);
    assert.equal(dirname(target), parent);
    assert.ok(basename(target).startsWith("fullparty-workshop-test-"));
    await rm(target, { recursive: true, force: true });
  });
  return { directory, path: join(directory, "versions.json") };
}

test("versions survive reopening, preserve payload/assets, and reject stale writes", async (t) => {
  const { path } = await fixture(t);
  const store = createVersionStore(path);
  const saved = await store.save(draft());
  assert.equal(saved.revision, 1);
  const reopened = createVersionStore(path);
  assert.deepEqual((await reopened.list()).versions, [saved]);
  const edited = await reopened.save(
    { ...saved, name: "Revised", message: { ...saved.message, content: "Ready!" } },
    saved.id,
  );
  assert.equal(edited.revision, 2);
  assert.equal(edited.createdAt, saved.createdAt);
  assert.deepEqual(edited.message.future_field, { retained: true });
  assert.deepEqual(edited.assets, saved.assets);
  await assert.rejects(reopened.save(saved, saved.id), { status: 409 });
  assert.equal((await reopened.list()).versions[0].name, "Revised");
});

test("queued saves do not lose alternatives and remove/undo is reversible", async (t) => {
  const { path } = await fixture(t);
  const store = createVersionStore(path);
  const saved = await Promise.all(
    Array.from({ length: 8 }, (_, i) => store.save(draft(`Option ${i}`))),
  );
  assert.equal((await store.list()).versions.length, 8);
  assert.equal(new Set(saved.map((v) => v.id)).size, 8);
  const archived = await store.archive(saved[0].id, 1);
  assert.ok(archived.archivedAt);
  await assert.rejects(store.save(archived, archived.id), { status: 409 });
  const restored = await store.restore(archived.id, archived.revision);
  assert.equal(restored.archivedAt, undefined);
  assert.equal(restored.revision, 3);
  assert.equal((await store.list()).versions.length, 8);
});

test("bad storage is never silently replaced and invalid versions are rejected", async (t) => {
  const { path } = await fixture(t);
  await writeFile(path, "{ broken library");
  const store = createVersionStore(path);
  await assert.rejects(store.list(), { status: 503 });
  await assert.rejects(store.save(draft()), { status: 503 });
  assert.equal(await readFile(path, "utf8"), "{ broken library");
  await assert.rejects(store.save({ ...draft(), name: " " }), { status: 400 });
  assert.throws(
    () => assertDraft({ ...draft(), message: JSON.parse('{"__proto__":{}}') }),
    /Unsupported object key/,
  );
});

test("reply branches have distinct keys and retain them across rebuilds", () => {
  const records = [
    { source: "src/example.ts:35", title: "example · line 35" },
    { source: "src/example.ts:35", title: "example · line 35" },
    { source: "src/another.ts:35", title: "example · line 35" },
  ];
  assignSourceKeys(records);
  const keys = records.map(sourceKey);
  assert.equal(new Set(keys).size, 3);
  assignSourceKeys(records);
  assert.deepEqual(records.map(sourceKey), keys);
});

test("renamed renderer cards retain the keys of their saved alternatives", () => {
  const savedKey = "src/commands/guildRuns.ts::guildRuns · line 104";
  const records = [
    {
      source: "src/commands/guildRuns.ts",
      title: "guildRuns · server link required",
      previewSourceKey: savedKey,
    },
  ];
  assignSourceKeys(records);
  assert.equal(sourceKey(records[0]), savedKey);
  assignSourceKeys(records);
  assert.equal(sourceKey(records[0]), savedKey);
});

test("diagnostics cover text limits, embed totals, and incompatible layouts", () => {
  assert.deepEqual(validateMessage({ content: "a".repeat(2000) }), []);
  assert.match(validateMessage({ content: "a".repeat(2001) }).join(), /2001 \/ 2000/);
  assert.match(
    validateMessage({
      embeds: [{ description: "a".repeat(4000) }, { description: "b".repeat(2001) }],
    }).join(),
    /6001 \/ 6000/,
  );
  assert.match(
    validateMessage({ embeds: [{ fields: [{ name: "", value: "" }] }] }).join(),
    /needs a name and value/,
  );
  assert.match(
    validateMessage({
      components: [{ type: 1, components: [newComponent(2), newComponent(3)] }],
    }).join(),
    /one select/,
  );
  assert.deepEqual(validateMessage({ flags: 32768, components: [newComponent(17)] }), []);
  assert.match(
    validateMessage({
      flags: 32768,
      content: "Hello",
      components: [newComponent(17)],
    }).join(),
    /cannot be combined/,
  );
  assert.match(
    validateMessage({
      flags: 64,
      poll: { question: { text: "When?" }, answers: [] },
    }).join(),
    /cannot be ephemeral/,
  );
});

test("renderer escapes content, supports local images and black accents, and tolerates draft shapes", () => {
  const render = createRenderer({ sampleNow: "2026-10-16T17:00:00Z", mentions: {} });
  const html = render(
    {
      content: "<img src=x onerror=alert(1)>",
      embeds: [
        {
          title: "Safe",
          url: "javascript:alert(1)",
          color: 0,
          image: { url: "attachment://sample.png" },
        },
      ],
    },
    {},
    draft().assets,
  );
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes("javascript:"));
  assert.match(html, /--color:#000000/);
  assert.match(html, /data:image\/png;base64,aGVsbG8=/);
  assert.match(render({ flags: 32768, components: [newComponent(17)] }), /v2-container/);
  assert.doesNotThrow(() =>
    render({
      embeds: [null, 3],
      files: [null, { name: 123 }],
      components: [
        { type: 3, options: [null], default_values: [null] },
        { type: 12, items: [null] },
        { type: 13, file: { url: 4 } },
      ],
    }),
  );
});

test("local API persists drafts, rejects cross-origin writes, and exposes only preview files", async (t) => {
  const { directory, path } = await fixture(t);
  await writeFile(join(directory, "index.html"), "<h1>Workshop</h1>");
  const server = createPreviewServer({ directory });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = "GET", body, extraHeaders = {}) =>
    fetch(base + path, {
      method,
      signal: AbortSignal.timeout(3000),
      headers: {
        "Content-Type": "application/json",
        "X-Preview-Editor": "1",
        Origin: base,
        ...extraHeaders,
      },
      ...(body === undefined
        ? {}
        : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    });
  const created = await request("/api/versions", "POST", draft());
  assert.equal(created.status, 201);
  const saved = await created.json();
  const response = await request(`/api/versions/${saved.id}`, "PUT", {
    ...saved,
    name: "Updated",
  });
  assert.equal(response.status, 200);
  const updated = await response.json();
  assert.equal((await request(`/api/versions/${saved.id}`, "PUT", saved)).status, 409);
  const archived = await (
    await request(`/api/versions/${saved.id}`, "DELETE", { revision: updated.revision })
  ).json();
  assert.ok(archived.archivedAt);
  assert.equal(
    (
      await request(`/api/versions/${saved.id}/restore`, "POST", {
        revision: archived.revision,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("/api/versions", "POST", draft(), {
        Origin: "https://unrelated.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (await request("/api/versions", "POST", draft(), { "X-Preview-Editor": "" })).status,
    403,
  );
  assert.equal((await request("/api/versions", "POST", "{oops")).status, 400);
  assert.equal((await request("/versions.json")).status, 404);
  assert.equal((await request("/cache/example.mjs")).status, 404);
  assert.equal((await request("/")).status, 200);
  const list = await (await request("/api/versions")).json();
  assert.equal(list.versions.length, 1);
  assert.equal(list.versions[0].name, "Updated");
  assert.equal(
    JSON.parse(await readFile(path, "utf8")).versions[0].archivedAt,
    undefined,
  );
});

test("Send Version sends unsaved drafts through the protected local API without saving", async (t) => {
  const { directory } = await fixture(t);
  const sent = [];
  const sender = {
    status: () => ({ enabled: true }),
    send: async (value) => {
      sent.push(value);
      if (value.message.content === "rejected") {
        const error = new Error("Discord rejected this preview: invalid component.");
        error.name = "WorkshopSendError";
        error.status = 400;
        throw error;
      }
      if (value.message.content === "unexpected")
        throw new Error("private backend detail");
      return { messageId: "123456789012345678" };
    },
  };
  const server = createPreviewServer({ directory, sender });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = {
    "Content-Type": "application/json",
    "X-Preview-Editor": "1",
    Origin: base,
  };
  const send = (body, overrides = {}) =>
    fetch(base + "/api/send-version", {
      method: "POST",
      headers: { ...headers, ...overrides },
      body: JSON.stringify(body),
    });
  assert.deepEqual(await (await fetch(base + "/api/send-version")).json(), {
    enabled: true,
  });
  const value = draft("Unsaved long draft");
  value.message = { flags: 32768, components: [{ type: 10, content: "x".repeat(3000) }] };
  assert.equal((await send(value, { Origin: "https://unrelated.example" })).status, 403);
  assert.equal((await send(value, { "X-Preview-Editor": "" })).status, 403);
  const badHostStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(
      base + "/api/send-version",
      {
        method: "POST",
        headers: { ...headers, Host: "unrelated.example:4318" },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    request.on("error", reject);
    request.end(JSON.stringify(value));
  });
  assert.equal(badHostStatus, 403);
  assert.equal(sent.length, 0);
  const response = await send(value);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { messageId: "123456789012345678" });
  assert.deepEqual(sent, [value]);
  assert.deepEqual(await (await fetch(base + "/api/versions")).json(), {
    schemaVersion: 1,
    versions: [],
  });
  const rejected = await send({ message: { content: "rejected" } });
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error, /Discord rejected this preview/);
  const unexpected = await send({ message: { content: "unexpected" } });
  assert.equal(unexpected.status, 502);
  assert.doesNotMatch(JSON.stringify(await unexpected.json()), /private backend detail/);
});

test("the offline workshop keeps saving available when no DM sender is configured", async (t) => {
  const { directory } = await fixture(t);
  const server = createPreviewServer({ directory });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await (await fetch(base + "/api/send-version")).json()).enabled, false);
  const response = await fetch(base + "/api/send-version", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Preview-Editor": "1",
      Origin: base,
    },
    body: JSON.stringify({ message: { content: "Hello" } }),
  });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /not configured/);
});
