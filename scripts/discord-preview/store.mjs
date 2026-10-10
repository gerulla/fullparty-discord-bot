import { readFile, writeFile, rename, mkdir, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { assertDraft, copy } from "./model.mjs";
export class StoreError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function createVersionStore(path) {
  let pending = Promise.resolve();
  async function read() {
    try {
      const data = JSON.parse(await readFile(path, "utf8"));
      if (data.schemaVersion !== 1 || !Array.isArray(data.versions))
        throw new Error("Unknown format");
      return data;
    } catch (error) {
      if (error.code === "ENOENT") return { schemaVersion: 1, versions: [] };
      throw new StoreError(
        503,
        "The saved version file could not be read. It has been left intact.",
      );
    }
  }
  function mutate(operation) {
    const next = pending.then(async () => {
      const data = await read();
      const result = operation(data);
      await mkdir(dirname(path), { recursive: true });
      const temp = path + "." + randomUUID() + ".tmp";
      try {
        await writeFile(temp, JSON.stringify(data, null, 2), { flag: "wx", mode: 0o600 });
        await rename(temp, path);
      } catch (error) {
        await unlink(temp).catch(() => {});
        throw error;
      }
      return copy(result);
    });
    pending = next.catch(() => {});
    return next;
  }
  return {
    async list() {
      await pending;
      return copy(await read());
    },
    async save(body, id) {
      try {
        assertDraft(body);
      } catch (error) {
        throw new StoreError(400, error.message);
      }
      return mutate((data) => {
        const existing = id ? data.versions.find((x) => x.id === id) : undefined;
        if (id && !existing) throw new StoreError(404, "Version not found.");
        if (existing && (existing.revision !== body.revision || existing.archivedAt))
          throw new StoreError(
            409,
            "This version changed in another editor. Export your draft, then reload the saved version.",
          );
        const at = new Date().toISOString();
        const saved = {
          id: id ?? randomUUID(),
          sourceKey: body.sourceKey,
          sourceTitle: body.sourceTitle,
          sourceGroup: body.sourceGroup ?? "",
          sourceId: body.sourceId ?? "",
          name: body.name.trim(),
          notes: body.notes ?? "",
          message: copy(body.message),
          preview: copy(body.preview ?? {}),
          assets: copy(body.assets ?? []),
          createdAt: existing?.createdAt ?? at,
          updatedAt: at,
          revision: (existing?.revision ?? 0) + 1,
        };
        if (existing) data.versions[data.versions.indexOf(existing)] = saved;
        else data.versions.push(saved);
        return saved;
      });
    },
    async archive(id, revision) {
      return mutate((data) => {
        const v = data.versions.find((x) => x.id === id);
        if (!v) throw new StoreError(404, "Version not found.");
        if (v.revision !== revision)
          throw new StoreError(409, "This version changed. Refresh before removing it.");
        v.archivedAt = new Date().toISOString();
        v.revision++;
        return v;
      });
    },
    async restore(id, revision) {
      return mutate((data) => {
        const v = data.versions.find((x) => x.id === id);
        if (!v) throw new StoreError(404, "Version not found.");
        if (v.revision !== revision)
          throw new StoreError(409, "This version changed. Refresh first.");
        delete v.archivedAt;
        v.revision++;
        return v;
      });
    },
  };
}
