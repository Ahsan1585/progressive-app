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

// Bresenham line, with a small brush radius so strokes are visible at this resolution.
function drawLine(pixels, x0, y0, x1, y1) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0, y = y0;
  for (;;) {
    setPixel(pixels, x, y, 20, 20, 30);
    setPixel(pixels, x + 1, y, 20, 20, 30);
    setPixel(pixels, x, y + 1, 20, 20, 30);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

/**
 * Generates a random squiggle that loosely resembles a handwritten
 * signature, rendered as a real (small, hand-encoded) PNG. Used only for
 * seeded/synthetic test data so different assessments don't all show the
 * exact same placeholder image — the raw pixel + PNG chunk encoding here
 * avoids adding a native image dependency (canvas/sharp) just for this.
 * Returns a `data:image/png;base64,...` string, matching the format
 * assessments.parent_signature/practitioner_signature normally store.
 */
function generateSignaturePng() {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 3, 255); // white background

  const segments = 4 + Math.floor(Math.random() * 3); // 4-6 segments
  const marginX = 20;
  const usableWidth = WIDTH - marginX * 2;
  const midY = HEIGHT / 2;

  let prevX = marginX;
  let prevY = midY + (Math.random() - 0.5) * 20;
  for (let i = 1; i <= segments; i++) {
    const x = marginX + (usableWidth * i) / segments;
    const y = midY + (Math.random() - 0.5) * (HEIGHT - 30);
    drawLine(pixels, prevX, prevY, x, y);
    prevX = x;
    prevY = y;
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
