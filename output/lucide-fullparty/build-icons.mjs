import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";

const require = createRequire(
  "C:/Users/egidi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json",
);
const sharp = require("sharp");
const directory = dirname(fileURLToPath(import.meta.url));
const color = "#A07AC7";
const specs = [
  ["success-check", "Success", "check"],
  ["error-x", "Error", "x"],
  ["update-looping-arrows", "Update", "refresh-cw"],
  ["note", "Note", "sticky-note"],
  ["document", "Document", "file-text"],
  ["percent", "Percent", "percent"],
  ["at-symbol", "@ symbol", "at-sign"],
  ["nametag", "Nametag", "id-card"],
];
const root = "https://raw.githubusercontent.com/lucide-icons/lucide/main/";
async function download(path) {
  const response = await fetch(root + path, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.text();
}
const downloads = await Promise.allSettled([
  ...specs.map(([, , icon]) => download(`icons/${icon}.svg`)),
  download("LICENSE"),
]);
const failed = downloads.filter((result) => result.status === "rejected");
if (failed.length)
  throw new AggregateError(
    failed.map((result) => result.reason),
    "Could not download Lucide assets",
  );
const values = downloads.map((result) => result.value);
await mkdir(join(directory, "png"), { recursive: true });
await mkdir(join(directory, "svg"), { recursive: true });
const manifest = {
  color,
  size: 256,
  strokeWidth: 2,
  background: "transparent",
  icons: [],
};
const tiles = [];
for (const [index, [filename, label, lucide]] of specs.entries()) {
  const original = values[index];
  if (!original.includes("<svg") || !original.includes('stroke="currentColor"'))
    throw new Error(`Unexpected SVG: ${lucide}`);
  const svg = original
    .replace('width="24"', 'width="256"')
    .replace('height="24"', 'height="256"')
    .replaceAll("currentColor", color);
  await writeFile(join(directory, "svg", filename + ".svg"), svg);
  await sharp(Buffer.from(svg))
    .png()
    .toFile(join(directory, "png", filename + ".png"));
  const { data, info } = await sharp(join(directory, "png", filename + ".png"))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== 256 || info.height !== 256 || info.channels !== 4 || data[3] !== 0)
    throw new Error(`Invalid PNG size or alpha: ${filename}`);
  let opaque = 0;
  for (let p = 0; p < data.length; p += 4) {
    if (data[p + 3] === 255) {
      opaque++;
      // Alpha compositing at overlapping stroke edges can round channels by one.
      if (
        Math.abs(data[p] - 160) > 1 ||
        Math.abs(data[p + 1] - 122) > 1 ||
        Math.abs(data[p + 2] - 199) > 1
      )
        throw new Error(`Incorrect color: ${filename}`);
    }
  }
  if (!opaque) throw new Error(`Empty icon: ${filename}`);
  manifest.icons.push({
    filename,
    label,
    lucide,
    source: `https://lucide.dev/icons/${lucide}`,
    sourceSha256: createHash("sha256").update(original).digest("hex"),
  });
  const inner = original.slice(original.indexOf(">") + 1, original.lastIndexOf("</svg>"));
  const x = 32 + (index % 4) * 240;
  const y = 116 + Math.floor(index / 4) * 250;
  tiles.push(
    `<g transform="translate(${x},${y})"><rect width="224" height="228" rx="12" fill="#211C29" stroke="#352A43"/><svg x="52" y="28" width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg><text x="112" y="184" text-anchor="middle" fill="#E7DFF0" font-family="Segoe UI, sans-serif" font-size="18">${label}</text><text x="112" y="209" text-anchor="middle" fill="#9789A6" font-family="Segoe UI, sans-serif" font-size="13">${lucide}</text></g>`,
  );
}
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="640"><rect width="1024" height="640" fill="#171419"/><text x="32" y="50" font-family="Segoe UI, sans-serif" font-size="28" font-weight="600" fill="#F3EDF9">FullParty / Lucide icons</text><text x="32" y="80" font-family="Segoe UI, sans-serif" font-size="16" fill="#AFA0BE">${color} · 256 × 256 PNG · transparent backgrounds · SVG originals</text>${tiles.join("")}</svg>`;
await sharp(Buffer.from(sheet)).png().toFile(join(directory, "preview.png"));
await writeFile(join(directory, "LICENSE-LUCIDE.txt"), values.at(-1), { flag: "wx" });
await writeFile(
  join(directory, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
  { flag: "wx" },
);
await writeFile(
  join(directory, "README.txt"),
  "FullParty purple Lucide icon pack\n\nColor: #A07AC7\nPNG size: 256 x 256 pixels, with transparent backgrounds\nSVG viewBox: 0 0 24 24, stroke width: 2, original Lucide geometry\nThe update icon is a static circular-arrows symbol.\nThe dark background and labels appear only in preview.png.\n\nIcons and source links:\n" +
    manifest.icons.map((i) => `${i.filename}: ${i.source}`).join("\n") +
    "\n\nLicense: see LICENSE-LUCIDE.txt (included from the upstream Lucide repository).\n",
  { flag: "wx" },
);
console.log(
  JSON.stringify(
    {
      directory,
      icons: manifest.icons.length,
      pngDimensions: "256x256",
      color,
      alpha: "verified",
      geometry: "official Lucide SVG",
    },
    null,
    2,
  ),
);
