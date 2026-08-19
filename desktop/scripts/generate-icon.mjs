// Generates the Windows .ico app icon from the same Izaya leaf-mark source
// mobile/scripts/generate-icons.mjs already uses for the PWA icon set —
// keeps the desktop app's icon visually consistent with the mobile app's,
// rather than sourcing a different logo asset. Squaring technique
// (center-crop via `fit: cover`, avoids the seam a flat-color pad would
// leave against the source's gradient background) mirrors that script
// exactly; only the final encode step (.ico instead of PNG) differs.
//
// Run: node scripts/generate-icon.mjs

import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(__dirname, "../build/icon.ico");
const sourcePath = "C:/Users/ahsan/Desktop/izaya Company Backup/Assets/Icon Logo.png";

const ICO_SIZES = [16, 32, 48, 256];

async function squareSource(size) {
  return sharp(sourcePath)
    .resize(size, size, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();
}

async function main() {
  const pngBuffers = await Promise.all(ICO_SIZES.map(squareSource));
  const icoBuffer = await pngToIco(pngBuffers);
  await writeFile(outPath, icoBuffer);
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
