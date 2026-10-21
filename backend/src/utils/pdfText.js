// Shared text safety for every string drawn with pdf-lib's standard fonts
// (Helvetica etc.), which use WinAnsi encoding and THROW on anything outside
// it. One 'Łukasz' or 'Nguyễn' would otherwise fail a whole SEVF, full
// record export or disclosure packet with a 500.
//
// Per character: control characters become a space; common Latin letters
// with no decomposition are mapped (Ł->L, ß->ss, Ø->O, Æ->AE, ...); anything
// else WinAnsi can already draw is kept as-is (so 'Zoë', 'José', curly
// quotes, dashes and the euro sign survive); anything else is NFKD-decomposed with combining marks
// stripped (ễ->e, narrow no-break space->space, ﬁ->fi); whatever is still
// unencodable becomes '?' (one per code point, so an emoji is a single '?').

const WINANSI_EXTRAS = new Set([
  0x152, 0x153, 0x160, 0x161, 0x178, 0x17d, 0x17e, 0x192, 0x2c6, 0x2dc, 0x2013, 0x2014, 0x2018, 0x2019,
  0x201a, 0x201c, 0x201d, 0x201e, 0x2020, 0x2021, 0x2022, 0x2026, 0x2030, 0x2039, 0x203a, 0x20ac, 0x2122,
]);

const LATIN_MAP = {
  'Ł': 'L', 'ł': 'l', 'Đ': 'D', 'đ': 'd', 'ß': 'ss', 'Ø': 'O', 'ø': 'o',
  'Æ': 'AE', 'æ': 'ae', 'Œ': 'OE', 'œ': 'oe', 'ı': 'i',
};

const isControl = (cp) => cp < 0x20 || cp === 0x7f || (cp >= 0x80 && cp < 0xa0);
const isEncodable = (cp) => (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WINANSI_EXTRAS.has(cp);
const COMBINING = /\p{M}/u;

function pdfSafeText(text) {
  let out = '';
  for (const ch of String(text ?? '').normalize('NFC')) {
    const cp = ch.codePointAt(0);
    if (isControl(cp)) { out += ' '; continue; }
    if (LATIN_MAP[ch]) { out += LATIN_MAP[ch]; continue; }
    if (isEncodable(cp)) { out += ch; continue; }
    if (COMBINING.test(ch)) continue; // a stray mark with no base letter
    let decomposed = '';
    let ok = true;
    for (const d of ch.normalize('NFKD')) {
      if (COMBINING.test(d)) continue;
      const dcp = d.codePointAt(0);
      if (LATIN_MAP[d]) decomposed += LATIN_MAP[d];
      else if (isEncodable(dcp)) decomposed += d;
      else { ok = false; break; }
    }
    out += ok && decomposed ? decomposed : '?';
  }
  return out;
}

// ASCII letters/digits/hyphens only, for a Content-Disposition filename
// segment: Node throws ERR_INVALID_CHAR on header values with characters
// such as a curly apostrophe, and quotes/CR/LF must never reach the header.
function safeFilenamePart(text, fallback = 'child') {
  const ascii = pdfSafeText(text).normalize('NFKD').replace(/\p{M}/gu, '');
  const cleaned = ascii.replace(/[^A-Za-z0-9-]/g, '').slice(0, 40);
  return cleaned || fallback;
}

module.exports = { pdfSafeText, safeFilenamePart };
