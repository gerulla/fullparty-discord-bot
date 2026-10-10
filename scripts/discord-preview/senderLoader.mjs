import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "dotenv";
import { build } from "esbuild";

// Loaded by the local server only. Credentials never enter the browser bundle.
export async function loadWorkshopSender() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  config({ path: resolve(root, ".env"), quiet: true });
  const cache = resolve(root, "data/discord-preview/cache");
  await mkdir(cache, { recursive: true });
  const outfile = resolve(cache, "workshopSender.mjs");
  await build({
    entryPoints: [resolve(root, "src/dev/workshopSender.ts")],
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  const { createWorkshopSender } = await import(pathToFileURL(outfile).href);
  return createWorkshopSender({ env: process.env });
}
