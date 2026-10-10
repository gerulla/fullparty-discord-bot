import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const sharp = createRequire('C:/Users/egidi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('sharp');
const directory = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
const color = manifest.color;
const specs = [
  ['flag', 'Flag', 'flag'],
  ['pin', 'Pin', 'pin'],
  ['clock', 'Clock', 'clock'],
  ['edit', 'Edit', 'square-pen'],
  ['chart', 'Chart', 'chart-no-axes-combined'],
];
const downloads = await Promise.allSettled(specs.map(async ([, , icon]) => {
  const response = await fetch(`https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/${icon}.svg`, {signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error(`${icon}: HTTP ${response.status}`);
  return response.text();
}));
const failed = downloads.filter(r => r.status === 'rejected');
if (failed.length) throw new AggregateError(failed.map(r => r.reason), 'Could not download Lucide SVGs');

for (const [index, [filename, label, lucide]] of specs.entries()) {
  const original = downloads[index].value;
  if (!original.includes('<svg') || !original.includes('stroke="currentColor"')) throw new Error(`Unexpected SVG: ${lucide}`);
  const svg = original.replace('width="24"', 'width="256"').replace('height="24"', 'height="256"').replaceAll('currentColor', color);
  await writeFile(join(directory, 'svg', filename + '.svg'), svg);
  await sharp(Buffer.from(svg)).png().toFile(join(directory, 'png', filename + '.png'));
  const {data, info} = await sharp(join(directory, 'png', filename + '.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  if (info.width !== 256 || info.height !== 256 || info.channels !== 4 || data[3] !== 0) throw new Error(`Invalid PNG: ${filename}`);
  let opaque = 0;
  for (let p = 0; p < data.length; p += 4) {
    if (data[p + 3] !== 255) continue;
    opaque++;
    if (Math.abs(data[p] - 160) > 1 || Math.abs(data[p + 1] - 122) > 1 || Math.abs(data[p + 2] - 199) > 1) throw new Error(`Incorrect color: ${filename}`);
  }
  if (!opaque) throw new Error(`Empty icon: ${filename}`);
  const entry = {filename, label, lucide, source:`https://lucide.dev/icons/${lucide}`, sourceSha256:createHash('sha256').update(original).digest('hex')};
  const existing = manifest.icons.findIndex(icon => icon.filename === filename);
  if (existing === -1) manifest.icons.push(entry);
  else manifest.icons[existing] = entry;
}

async function preview(icons, columns, path) {
  const width = 64 + columns * 240;
  const height = 140 + Math.ceil(icons.length / columns) * 250;
  const tiles = [];
  for (const [index, icon] of icons.entries()) {
    const svg = await readFile(join(directory, 'svg', icon.filename + '.svg'), 'utf8');
    const inner = svg.slice(svg.indexOf('>') + 1, svg.lastIndexOf('</svg>'));
    const x = 32 + index % columns * 240;
    const y = 116 + Math.floor(index / columns) * 250;
    tiles.push(`<g transform="translate(${x},${y})"><rect width="224" height="228" rx="12" fill="#211C29" stroke="#352A43"/><svg x="52" y="28" width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg><text x="112" y="184" text-anchor="middle" fill="#E7DFF0" font-family="Segoe UI, sans-serif" font-size="18">${icon.label}</text><text x="112" y="209" text-anchor="middle" fill="#9789A6" font-family="Segoe UI, sans-serif" font-size="13">${icon.lucide}</text></g>`);
  }
  const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#171419"/><text x="32" y="50" font-family="Segoe UI, sans-serif" font-size="28" font-weight="600" fill="#F3EDF9">FullParty / Lucide icons</text><text x="32" y="80" font-family="Segoe UI, sans-serif" font-size="16" fill="#AFA0BE">${color} · 256 × 256 PNG · transparent backgrounds · SVG originals</text>${tiles.join('')}</svg>`;
  await sharp(Buffer.from(sheet)).png().toFile(join(directory, path));
}
const added = manifest.icons.filter(icon => specs.some(([filename]) => filename === icon.filename));
await preview(added, 5, 'preview-additional.png');
await preview(manifest.icons, 4, 'preview.png');
await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(join(directory, 'manifest-additional.json'), JSON.stringify({...manifest,icons:added}, null, 2) + '\n');
await writeFile(join(directory, 'README.txt'), 'FullParty purple Lucide icon pack\n\nColor: #A07AC7\nPNG size: 256 x 256 pixels, with transparent backgrounds\nSVG viewBox: 0 0 24 24, stroke width: 2, original Lucide geometry\nThe update icon is a static circular-arrows symbol.\nThe dark background and labels appear only in the preview sheets.\n\nIcons and source links:\n' + manifest.icons.map(i => `${i.filename}: ${i.source}`).join('\n') + '\n\nLicense: see LICENSE-LUCIDE.txt (included from the upstream Lucide repository).\n');
console.log(JSON.stringify({added:added.map(i => i.filename), total:manifest.icons.length, color, size:'256x256',alpha:'verified'},null,2));
