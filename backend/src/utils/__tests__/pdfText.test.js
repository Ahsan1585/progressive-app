const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { pdfSafeText, safeFilenamePart } = require('../pdfText');
const { buildNjeisPdfForGroup } = require('../njeisFormFiller');

describe('pdfSafeText', () => {
  test.each([
    ['Nguyễn', 'Nguyen'],
    ['Łukasz', 'Lukasz'],
    ['łódź', 'lódz'],
    ['Đorđe đ', 'Dorde d'],
    ['Straße', 'Strasse'],
    ['Øystein ø', 'Oystein o'],
    ['Æsir æ Œuvre œ', 'AEsir ae OEuvre oe'],
    ['Kırık', 'Kirik'],
    // WinAnsi-encodable text is kept as-is (Latin-1 + curly quotes, dashes, euro).
    ['Zoë O’Brien – café €5 “ok”', 'Zoë O’Brien – café €5 “ok”'],
    // Decomposed input (e + combining acute) is recomposed, not stripped.
    ['José', 'José'],
    ['서울 Clinic 📄', '?? Clinic ?'],
    ['a\nb\tc', 'a b c'],
    ['10:05 AM', '10:05 AM'],
    [null, ''],
  ])('%j -> %j', (input, expected) => {
    expect(pdfSafeText(input)).toBe(expected);
  });

  test('every output is encodable by the standard Helvetica font', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const input = 'Łukasz Nguyễn ß Ø Æ Œ ı 서울 📄 ℃ ½ ﬁ ́ ‐ ‑';
    expect(() => font.encodeText(pdfSafeText(input))).not.toThrow();
  });
});

describe('safeFilenamePart', () => {
  test.each([
    ['O’Brien', 'OBrien'],
    ["O'Brien", 'OBrien'],
    ['Łukasz', 'Lukasz'],
    ['Nguyễn', 'Nguyen'],
    ['Bad"Name\r\nX', 'BadNameX'],
    ['서울', 'child'],
    ['', 'child'],
    [null, 'child'],
  ])('%j -> %j', (input, expected) => {
    expect(safeFilenamePart(input)).toBe(expected);
  });

  test('custom fallback, length cap, and only header-safe characters', () => {
    expect(safeFilenamePart('***', 'record')).toBe('record');
    expect(safeFilenamePart('x'.repeat(100))).toHaveLength(40);
    expect(safeFilenamePart('a b—c')).toMatch(/^[A-Za-z0-9-]+$/);
  });
});

describe('SEVF filler with non-WinAnsi names', () => {
  test("a SEVF for 'Łukasz Nguyễn' (county Łódź) is generated instead of throwing", async () => {
    const templateBytes = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'templates', 'NJEIS-020.pdf'));
    const rows = [{
      patient_first_name: 'Łukasz', patient_last_name: 'Nguyễn', patient_county: 'Łódź',
      practitioner_first_name: 'Đức', practitioner_last_name: 'Trần', service_date: '2026-09-01',
      type: 'SI', location: 'Home 🏠', start_time: '09:00', end_time: '10:00', total_time: 60,
    }];
    const doc = await buildNjeisPdfForGroup(templateBytes, rows, 'Acme Ełk', { position_title: '' });
    expect(doc.getPageCount()).toBe(1);
    const bytes = await doc.save();
    expect(Buffer.from(bytes).slice(0, 5).toString()).toBe('%PDF-');
  });
});
