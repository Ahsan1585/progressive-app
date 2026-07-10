// Generates the PWA app icon set from a small SVG source, entirely locally
// (no external/paid image-generation service) using `sharp` to rasterize.
//
// Brand mark: a rounded-square blue-600 (#2563EB) background with a bold
// white "PS" monogram (Progressive Steps), consistent with the app's
// Clinical Trust Blue art direction (design/practitioner-mobile-app-art-direction.md).
//
// Run: node scripts/generate-icons.mjs

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "../public/icons");

const BLUE = "#2563EB";
const WHITE = "#FFFFFF";
// Bold, clean sans-serif fallback stack — Geist first, generic bold sans as
// fallback since Geist is not guaranteed to be installed as a system font
// wherever this script (or a downstream rsvg renderer) runs.
const FONT_STACK = "Geist, 'Geist Variable', Arial, Helvetica, sans-serif";

/**
 * Builds the monogram SVG.
 *
 * @param {object} opts
 * @param {number} opts.size - canvas size in px (square)
 * @param {number} opts.cornerRadius - corner radius in px (0 = sharp square,
 *   appropriate for apple-touch-icon and maskable icons where the OS applies
 *   its own mask)
 * @param {number} opts.markScale - monogram font-size as a fraction of size
 */
function buildSvg({ size, cornerRadius, markScale }) {
  const fontSize = Math.round(size * markScale);
  const cy = size / 2;
  // Small manual nudge upward so the optical center of the glyph baseline
  // lands in the visual middle of the square (cap-height vs. descender).
  const dy = Math.round(size * 0.035);

  return `
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${size}" height="${size}" rx="${cornerRadius}" ry="${cornerRadius}" fill="${BLUE}" />
  <text
    x="50%"
    y="${cy + dy}"
    text-anchor="middle"
    dominant-baseline="middle"
    font-family="${FONT_STACK}"
    font-weight="700"
    font-size="${fontSize}"
    letter-spacing="${-Math.round(fontSize * 0.02)}"
    fill="${WHITE}"
  >PS</text>
</svg>`;
}

async function renderPng(svg, size, outFile) {
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(outFile);
  console.log(`wrote ${path.relative(process.cwd(), outFile)}`);
}

async function main() {
  await mkdir(outDir, { recursive: true });

  // Standard icons — rounded square, mark fills most of the canvas.
  // Corner radius follows the app's shape lock (~18px at 512 scale ≈ 3.5%).
  await renderPng(
    buildSvg({ size: 192, cornerRadius: Math.round(192 * 0.22), markScale: 0.5 }),
    192,
    path.join(outDir, "icon-192.png"),
  );
  await renderPng(
    buildSvg({ size: 512, cornerRadius: Math.round(512 * 0.22), markScale: 0.5 }),
    512,
    path.join(outDir, "icon-512.png"),
  );

  // Maskable icon — full-bleed square (no baked-in rounding; the OS applies
  // its own mask shape), mark kept well inside the ~80%-diameter safe zone.
  await renderPng(
    buildSvg({ size: 512, cornerRadius: 0, markScale: 0.34 }),
    512,
    path.join(outDir, "icon-512-maskable.png"),
  );

  // Apple touch icon — iOS applies its own squircle mask, so ship a
  // full-bleed square too, per Apple's guidance.
  await renderPng(
    buildSvg({ size: 180, cornerRadius: 0, markScale: 0.46 }),
    180,
    path.join(outDir, "apple-touch-icon.png"),
  );

  console.log("Icon generation complete.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
