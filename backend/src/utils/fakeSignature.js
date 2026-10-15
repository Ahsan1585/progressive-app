const zlib = require('zlib');

const WIDTH = 240;
const HEIGHT = 80;

// Standard PNG CRC32 (table-based), per the PNG spec appendix.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function setPixel(pixels, x, y, r, g, b) {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
  const idx = (y * WIDTH + x) * 3;
  pixels[idx] = r;
  pixels[idx + 1] = g;
  pixels[idx + 2] = b;
}

// Bresenham line with a brush of the given pixel radius — used by
// drawStroke below to vary line thickness the way real pen pressure does
// (thin on fast strokes, thicker on slow loops/connectors).
function drawLine(pixels, x0, y0, x1, y1, radius = 0) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0, y = y0;
  for (;;) {
    for (let oy = -radius; oy <= radius; oy++) {
      for (let ox = -radius; ox <= radius; ox++) {
        if (ox * ox + oy * oy <= radius * radius + 0.5) {
          setPixel(pixels, x + ox, y + oy, 15, 15, 25);
        }
      }
    }
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

// Draws a single quadratic Bézier stroke (start -> control -> end) as a
// chain of short line segments, with the brush radius tapering thin at
// both ends and thicker in the middle — this one shape change is most of
// what separates a real signature's letterforms (curved loops, tapered
// strokes) from a jagged straight-line zigzag.
function drawBezierStroke(pixels, p0, p1, p2, steps = 24, thicknessScale = 1) {
  let prev = p0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x = mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x;
    const y = mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y;
    // Taper: thin at the stroke's start/end, peak thickness around the
    // midpoint — mirrors how a pen naturally presses harder mid-stroke.
    const taper = Math.sin(Math.PI * t);
    const radius = Math.round((0.6 + taper * 1.2) * thicknessScale);
    drawLine(pixels, prev.x, prev.y, x, y, radius);
    prev = { x, y };
  }
}

const rand = (min, max) => min + Math.random() * (max - min);

/**
 * Generates a random squiggle that loosely resembles a handwritten
 * signature, rendered as a real (small, hand-encoded) PNG. Used only for
 * seeded/synthetic test data so different assessments don't all show the
 * exact same placeholder image — the raw pixel + PNG chunk encoding here
 * avoids adding a native image dependency (canvas/sharp) just for this.
 * Returns a `data:image/png;base64,...` string, matching the format
 * assessments.parent_signature/practitioner_signature normally store.
 */
// One connected cursive "word" — a run of 2-5 letterform units (loops,
// ascender/descender spikes, humps) with NO pen lift between them, drawn
// starting at (x, baseline). Returns the x position just past the word's
// last unit, so the caller can leave a gap before the next word. Baseline
// itself wobbles slightly unit-to-unit (real handwriting never sits on a
// perfectly flat line), and stroke thickness jitters per-unit instead of
// following one smooth taper formula for the whole signature.
function drawCursiveWord(pixels, x, baseline, maxWidth) {
  const unitCount = 2 + Math.floor(Math.random() * 4); // 2-5
  const unitWidth = maxWidth / unitCount;
  let cursorX = x;
  let cursorY = baseline + rand(-3, 3);
  let localBaseline = baseline;

  for (let u = 0; u < unitCount; u++) {
    const w = unitWidth * rand(0.7, 1.15);
    const shape = Math.floor(Math.random() * 4);
    const startX = cursorX;
    const startY = cursorY;
    localBaseline += rand(-2.5, 2.5); // baseline wobble, not a flat line
    const thickness = rand(0.8, 1.6);

    if (shape === 0) {
      // Loop that crosses back over its own upstroke (like a cursive "l"/"e").
      const peakY = localBaseline - rand(18, 30);
      const p0 = { x: startX, y: startY };
      const p1 = { x: startX + w * 0.15, y: peakY - rand(4, 10) };
      const p2 = { x: startX + w * 0.5, y: peakY };
      drawBezierStroke(pixels, p0, p1, p2, 14, thickness);
      const p3 = { x: startX + w * 0.35, y: localBaseline + rand(-2, 4) };
      const p4 = { x: startX + w, y: localBaseline };
      drawBezierStroke(pixels, p2, p3, p4, 16, thickness);
      cursorX = startX + w;
      cursorY = localBaseline;
    } else if (shape === 1) {
      // Ascender/descender spike (like a cursive "t"/"g"/"y").
      const upY = localBaseline - rand(20, 36);
      const downY = localBaseline + rand(8, 20);
      const p0 = { x: startX, y: startY };
      const p1 = { x: startX + w * 0.25, y: upY + rand(0, 8) };
      const p2 = { x: startX + w * 0.5, y: upY };
      drawBezierStroke(pixels, p0, p1, p2, 12, thickness);
      const p3 = { x: startX + w * 0.75, y: downY - rand(0, 8) };
      const p4 = { x: startX + w, y: downY };
      drawBezierStroke(pixels, p2, p3, p4, 12, thickness);
      cursorX = startX + w;
      cursorY = downY;
    } else if (shape === 2) {
      // Hump (cursive "m"/"n"/"w" ripple).
      const peakY = localBaseline - rand(6, 16);
      const p0 = { x: startX, y: startY };
      const p1 = { x: startX + w * 0.5, y: peakY };
      const p2 = { x: startX + w, y: localBaseline + rand(-4, 4) };
      drawBezierStroke(pixels, p0, p1, p2, 14, thickness);
      cursorX = startX + w;
      cursorY = p2.y;
    } else {
      // Flat connector stroke — real cursive doesn't peak on every single
      // letter; some units are just a low, mostly-straight joining stroke.
      const p0 = { x: startX, y: startY };
      const p1 = { x: startX + w * 0.5, y: localBaseline + rand(-5, 5) };
      const p2 = { x: startX + w, y: localBaseline + rand(-3, 3) };
      drawBezierStroke(pixels, p0, p1, p2, 10, thickness * 0.8);
      cursorX = startX + w;
      cursorY = p2.y;
    }
  }
  return cursorX;
}

function generateSignaturePng() {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 3, 255); // white background

  // Two "words" (e.g. first + last name) with a real pen-lift gap between
  // them — a single unbroken stroke across the whole width was the other
  // big tell that the old output wasn't handwriting.
  const marginX = 14;
  const baseline = HEIGHT * 0.58;
  const gap = rand(10, 18);
  const totalUsable = WIDTH - marginX * 2 - gap;
  const firstWordWidth = totalUsable * rand(0.42, 0.55);
  const secondWordWidth = totalUsable - firstWordWidth;

  const afterFirst = drawCursiveWord(pixels, marginX, baseline, firstWordWidth);
  drawCursiveWord(pixels, afterFirst + gap, baseline, secondWordWidth);

  // Underline flourish — common in real signatures, and a cheap way to
  // make the whole thing read as "a name was signed" at a glance.
  if (Math.random() < 0.65) {
    const ulY = baseline + rand(18, 26);
    drawBezierStroke(
      pixels,
      { x: marginX + 2, y: ulY },
      { x: WIDTH / 2, y: ulY + rand(-5, 5) },
      { x: WIDTH - marginX - 2, y: ulY + rand(-3, 3) },
      20,
      rand(0.8, 1.3)
    );
  }

  const rawWithFilters = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    const rowStart = y * (WIDTH * 3 + 1);
    rawWithFilters[rowStart] = 0; // filter type 0 (none)
    pixels.copy(rawWithFilters, rowStart + 1, y * WIDTH * 3, (y + 1) * WIDTH * 3);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const idatData = zlib.deflateSync(rawWithFilters);

  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const png = Buffer.concat([
    pngSignature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);

  return `data:image/png;base64,${png.toString('base64')}`;
}

module.exports = { generateSignaturePng };
