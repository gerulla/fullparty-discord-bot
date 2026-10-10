import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createVersionStore, StoreError } from "./store.mjs";
export function createPreviewServer({
  directory = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../data/discord-preview",
  ),
  store = createVersionStore(resolve(directory, "versions.json")),
  sender,
} = {}) {
  const json = (res, status, data) =>
    res
      .writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      })
      .end(JSON.stringify(data));
  return createServer(async (req, res) => {
    try {
      const host = req.headers.host ?? "";
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) {
        json(res, 403, { error: "This editor is local only." });
        return;
      }
      const path = new URL(req.url, "http://" + host).pathname;
      if (path.startsWith("/api/")) {
        if (req.headers.origin && req.headers.origin !== "http://" + host) {
          json(res, 403, { error: "Cross-origin access is not allowed." });
          return;
        }
        if (path === "/api/send-version") {
          if (
            !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress)
          ) {
            json(res, 403, { error: "DM previews are available only on this computer." });
            return;
          }
          if (req.method === "GET") {
            json(
              res,
              200,
              sender?.status() ?? {
                enabled: false,
                reason:
                  "Restart the workshop with npm.cmd run preview:discord to enable DM previews.",
              },
            );
            return;
          }
        }
        if (req.method === "GET" && path === "/api/versions") {
          json(res, 200, await store.list());
          return;
        }
        if (
          req.headers["x-preview-editor"] !== "1" ||
          !req.headers["content-type"]?.startsWith("application/json")
        ) {
          json(res, 403, { error: "Use the response editor for this action." });
          return;
        }
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 16 * 1024 * 1024)
            throw new StoreError(
              413,
              "The version exceeds the 16 MB local save limit. Reduce attachment sizes.",
            );
          chunks.push(chunk);
        }
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          throw new StoreError(400, "Invalid JSON.");
        }
        if (req.method === "POST" && path === "/api/versions") {
          json(res, 201, await store.save(body));
          return;
        }
        if (req.method === "POST" && path === "/api/send-version") {
          if (!sender)
            throw new StoreError(
              503,
              "DM previews are not configured. Restart the workshop with npm.cmd run preview:discord.",
            );
          try {
            json(res, 200, await sender.send(body));
          } catch (error) {
            throw new StoreError(
              error.name === "WorkshopSendError" ? error.status : 502,
              error.name === "WorkshopSendError"
                ? error.message
                : "Could not confirm Discord delivery. Check your DMs before trying again.",
            );
          }
          return;
        }
        const match = path.match(/^\/api\/versions\/([a-f0-9-]{36})(\/restore)?$/);
        if (match) {
          if (req.method === "PUT" && !match[2]) {
            json(res, 200, await store.save(body, match[1]));
            return;
          }
          if (req.method === "DELETE" && !match[2]) {
            json(res, 200, await store.archive(match[1], body.revision));
            return;
          }
          if (req.method === "POST" && match[2]) {
            json(res, 200, await store.restore(match[1], body.revision));
            return;
          }
        }
        json(res, 404, { error: "Unknown editor endpoint." });
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405).end();
        return;
      }
      const file = path === "/" ? "index.html" : path.slice(1);
      if (
        !/^(index\.html|messages\.json|README\.txt|images\/[a-z0-9-]+\.jpg)$/.test(file)
      ) {
        res.writeHead(404).end();
        return;
      }
      let content;
      try {
        content = await readFile(resolve(directory, file));
      } catch (error) {
        if (error.code === "ENOENT") {
          res.writeHead(404).end();
          return;
        }
        throw error;
      }
      const type = file.endsWith(".html")
        ? "text/html; charset=utf-8"
        : file.endsWith(".json")
          ? "application/json"
          : file.endsWith(".jpg")
            ? "image/jpeg"
            : "text/plain";
      res
        .writeHead(200, {
          "Content-Type": type,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
        })
        .end(req.method === "HEAD" ? undefined : content);
    } catch (error) {
      json(res, error.status ?? 500, {
        error:
          error instanceof StoreError
            ? error.message
            : "Could not save or load the local preview. Your draft has been kept in the editor.",
      });
    }
  });
}
