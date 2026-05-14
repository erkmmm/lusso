/**
 * Generates PNG app icons for the Lusso PWA.
 * Takes the white logo, centres it on a teal background, exports at all sizes.
 */

import sharp from 'sharp';
import { existsSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT  = join(__dirname, '../public');

// ── Source logo ───────────────────────────────────────────────────────────────
// White logo PNG — copy from Downloads the first time, then keep in public/
const LOGO_SRC  = 'C:/Users/hopki/Downloads/lusso  logo white.png';
const LOGO_DEST = join(OUT, 'lusso-logo-source.png');

if (!existsSync(LOGO_DEST)) {
  if (existsSync(LOGO_SRC)) {
    copyFileSync(LOGO_SRC, LOGO_DEST);
    console.log('[icons] copied logo from Downloads');
  } else {
    console.error('[icons] ERROR: logo not found at', LOGO_SRC);
    process.exit(1);
  }
}

// ── Brand colour: #174D4D ─────────────────────────────────────────────────────
const BG = { r: 0x17, g: 0x4D, b: 0x4D, alpha: 1 };

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
  const logoResized = await sharp(LOGO_DEST)
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
