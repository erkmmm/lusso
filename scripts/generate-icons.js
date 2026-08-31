/**
 * Generates the favicon + PWA app icons for Lusso.
 * Takes the black logo, centres it on a white background, exports at all sizes.
 */

import sharp from 'sharp';
import { existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT  = join(__dirname, '../public');

// ── Source logo ───────────────────────────────────────────────────────────────
// Black logo PNG (black block, letters knocked out white) — reads as a black
// mark once it sits on the white background below.
const LOGO = join(OUT, 'brand/lusso-black.png');

if (!existsSync(LOGO)) {
  console.error('[icons] ERROR: logo not found at', LOGO);
  process.exit(1);
}

// ── Background: white ─────────────────────────────────────────────────────────
const BG = { r: 0xff, g: 0xff, b: 0xff, alpha: 1 };

// ── Icon sizes ────────────────────────────────────────────────────────────────
const ICONS = [
  { size: 512, name: 'icon-512.png',         pad: 0.18 },
  { size: 192, name: 'icon-192.png',         pad: 0.18 },
  { size: 180, name: 'apple-touch-icon.png', pad: 0.18 },
  { size:  32, name: 'favicon-32.png',       pad: 0.12 },
];

for (const { size, name, pad } of ICONS) {
  const logoSize = Math.round(size * (1 - pad * 2));

  // Resize logo to fit, preserving aspect ratio, on transparent background
  const logoResized = await sharp(LOGO)
    .resize(logoSize, logoSize, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // Get actual dimensions after resize (may be narrower due to aspect ratio)
  const meta = await sharp(logoResized).metadata();
  const left = Math.round((size - meta.width)  / 2);
  const top  = Math.round((size - meta.height) / 2);

  await sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([{ input: logoResized, left, top }])
    .png()
    .toFile(join(OUT, name));

  console.log(`[icons] ✓ ${name} (${size}×${size})`);
}

// ── favicon.svg ───────────────────────────────────────────────────────────────
// Browsers prefer the SVG icon over the PNGs for tabs, so it has to match:
// same white tile, same black mark. The logo is embedded as a data URI so the
// file stays self-contained.
{
  const SIZE = 512;
  const PAD  = 0.12;
  const logoW = Math.round(SIZE * (1 - PAD * 2));

  const logoResized = await sharp(LOGO)
    .resize(logoW, logoW, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const meta = await sharp(logoResized).metadata();
  const x = ((SIZE - meta.width)  / 2).toFixed(2);
  const y = ((SIZE - meta.height) / 2).toFixed(2);

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
    `<rect width="${SIZE}" height="${SIZE}" fill="#ffffff"/>` +
    `<image x="${x}" y="${y}" width="${meta.width}" height="${meta.height}" ` +
    `xlink:href="data:image/png;base64,${logoResized.toString('base64')}"/>` +
    `</svg>\n`;

  writeFileSync(join(OUT, 'favicon.svg'), svg);
  console.log(`[icons] ✓ favicon.svg (${SIZE}×${SIZE})`);
}
