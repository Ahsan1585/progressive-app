// Generates the PWA app icon set from the Izaya leaf-mark source image,
// entirely locally (no external/paid image-generation service) using
// `sharp` to composite/resize.
//
// Source: the Izaya leaf logo (teal sprout on a dark navy gradient),
// provided as a small non-square PNG — padded to a square canvas (using
// the source's own corner color) before resizing, so the artwork isn't
// stretched.
//
// Run: node scripts/generate-icons.mjs

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "../public/icons");
const sourcePath = "C:/Users/ahsan/Desktop/izaya Company Backup/Assets/Icon Logo.png";

// Squares the source via a center-crop (`fit: cover`) rather than padding —
// the source's own background is a gradient, so padding with a flat sampled
// color left a visible seam where the pad met the gradient. Cover-cropping
// uses only the source's own pixels, so there's no seam at all.
// `contentScale` <1 leaves a margin (used for the maskable icon's required
// safe zone), padded with a color sampled from the *cropped* square's own
// corner so it blends with the gradient at that specific edge.
async function squareSource(size, contentScale) {
  const squared = await sharp(sourcePath)
    .resize(size, size, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();

  if (contentScale >= 1) {
    return squared;
  }

  const corner = await sharp(squared).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
  const bg = { r: corner[0], g: corner[1], b: corner[2], alpha: 1 };

  const innerSize = Math.round(size * contentScale);
  const resizedLogo = await sharp(squared).resize(innerSize, innerSize).toBuffer();
  const offset = Math.round((size - innerSize) / 2);

  return sharp({
    create: { width: size, height: size, channels: 4, background: bg },
  })
    .composite([{ input: resizedLogo, left: offset, top: offset }])
    .png()
    .toBuffer();
}

// Applies a rounded-rect mask (for the standard, non-maskable icon sizes —
// the OS doesn't apply its own shape to these).
async function withRoundedCorners(buffer, size, cornerRadius) {
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><rect x="0" y="0" width="${size}" height="${size}" rx="${cornerRadius}" ry="${cornerRadius}" fill="#fff"/></svg>`
  );
  return sharp(buffer)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

async function main() {
  await mkdir(outDir, { recursive: true });

  // Standard icons — rounded square, logo fills the canvas.
  const square192 = await squareSource(192, 1);
  await withRoundedCorners(square192, 192, Math.round(192 * 0.22)).then((buf) =>
    sharp(buf).toFile(path.join(outDir, "icon-192.png"))
  );

  const square512 = await squareSource(512, 1);
  await withRoundedCorners(square512, 512, Math.round(512 * 0.22)).then((buf) =>
    sharp(buf).toFile(path.join(outDir, "icon-512.png"))
  );

  // Maskable icon — full-bleed square (no baked-in rounding; the OS applies
  // its own mask shape), logo kept inside the ~80%-diameter safe zone.
  const maskable512 = await squareSource(512, 0.62);
  await sharp(maskable512).toFile(path.join(outDir, "icon-512-maskable.png"));

  // Apple touch icon — iOS applies its own squircle mask, so ship a
  // full-bleed square too, per Apple's guidance.
  const apple180 = await squareSource(180, 1);
  await sharp(apple180).toFile(path.join(outDir, "apple-touch-icon.png"));

  console.log("Icon generation complete.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
