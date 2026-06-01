import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const defaultAdminUiRoot = fileURLToPath(
  new URL("../../admin-ui/dist/", import.meta.url),
);

export type AdminUiOptions = {
  adminUiRoot?: string | undefined;
};

export async function handleAdminUiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: AdminUiOptions = {},
): Promise<boolean> {
  if (!isAdminUiPath(url.pathname)) {
    return false;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    sendResponse(response, 405, "Admin UI only supports GET requests.", "text/plain");
    return true;
  }

  if (url.pathname === "/admin") {
    response.writeHead(308, {
      location: "/admin/",
    });
    response.end();
    return true;
  }

  const root = resolve(options.adminUiRoot ?? defaultAdminUiRoot);
  const requestedFilePath = resolveAdminFilePath(root, url.pathname);

  if (!requestedFilePath) {
    sendResponse(response, 400, "Invalid admin asset path.", "text/plain");
    return true;
  }

  const indexPath = resolve(root, "index.html");
  const requestedFile = await isReadableFile(requestedFilePath);
  const indexFile = await isReadableFile(indexPath);
  const filePath = requestedFile ?? indexFile;

  if (!filePath) {
    sendResponse(
      response,
      503,
      "Admin UI has not been built yet. Run `npm run admin:build`.",
      "text/plain",
    );
    return true;
  }

  const body = await readFile(filePath);
  const contentType = getContentType(filePath);

  response.writeHead(200, {
    "cache-control": filePath === indexPath ? "no-store" : "public, max-age=31536000",
    "content-length": body.byteLength,
    "content-type": contentType,
  });

  if (request.method === "HEAD") {
    response.end();
    return true;
  }

  response.end(body);
  return true;
}

function isAdminUiPath(pathname: string): boolean {
  return (
    pathname === "/admin" ||
    (pathname.startsWith("/admin/") &&
      pathname !== "/admin/api" &&
      !pathname.startsWith("/admin/api/"))
  );
}

function resolveAdminFilePath(root: string, pathname: string): string | undefined {
  const decodedPath = decodePath(pathname.slice("/admin/".length));

  if (decodedPath === undefined) {
    return undefined;
  }

  const relativePath = decodedPath || "index.html";
  const filePath = resolve(root, relativePath);

  return isPathInside(root, filePath) ? filePath : undefined;
}

function decodePath(pathname: string): string | undefined {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
}

async function isReadableFile(filePath: string): Promise<string | undefined> {
  try {
    const fileStat = await stat(filePath);

    return fileStat.isFile() ? filePath : undefined;
  } catch {
    return undefined;
  }
}

function isPathInside(root: string, filePath: string): boolean {
  const rootWithSeparator = root.endsWith(sep) ? root : `${root}${sep}`;

  return filePath === root || filePath.startsWith(rootWithSeparator);
}

function getContentType(filePath: string): string {
  const contentTypes: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
  };

  return contentTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function sendResponse(
  response: ServerResponse,
  statusCode: number,
  body: string,
  contentType: string,
): void {
  response.writeHead(statusCode, {
    "content-length": Buffer.byteLength(body),
    "content-type": contentType,
  });
  response.end(body);
}
