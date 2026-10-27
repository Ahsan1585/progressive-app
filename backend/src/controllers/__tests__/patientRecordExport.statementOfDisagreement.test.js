// A recorded Statement of Disagreement (34 CFR 303.412-413 / FERPA 34 CFR
// 99.21) must travel with every disclosure of a child's record.
jest.mock('../../config/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../utils/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../utils/companyName', () => ({ getCompanyName: jest.fn() }));

const { pool } = require('../../config/db');
const { getCompanyName } = require('../../utils/companyName');
const { buildFullRecordPdf, drawStatementsOfDisagreement, drawCoverPage, fetchStatementsOfDisagreement } = require('../patientRecordExportController');

afterEach(() => jest.resetAllMocks());

describe('fetchStatementsOfDisagreement', () => {
  test('queries correction_requests for this patient, non-null statements only, oldest first', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ statement_of_disagreement: 'We disagree.', statement_recorded_at: '2026-10-01T00:00:00Z' }] });
    const rows = await fetchStatementsOfDisagreement(10);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringMatching(/FROM correction_requests[\s\S]*WHERE patient_id = \$1 AND statement_of_disagreement IS NOT NULL[\s\S]*ORDER BY statement_recorded_at ASC/),
      [10]
    );
    expect(rows).toHaveLength(1);
  });
});

describe('drawStatementsOfDisagreement', () => {
  test('is a no-op (returns the same y) when there are no statements', () => {
    const page = { drawRectangle: jest.fn(), drawText: jest.fn() };
    const y = drawStatementsOfDisagreement(page, 500, { regular: {}, bold: {} }, []);
    expect(y).toBe(500);
    expect(page.drawRectangle).not.toHaveBeenCalled();
  });

  test('draws a boxed notice with the statement text for each statement', () => {
    const page = { drawRectangle: jest.fn(), drawText: jest.fn() };
    const fonts = { regular: { widthOfTextAtSize: (t, s) => t.length * s * 0.5 }, bold: { widthOfTextAtSize: (t, s) => t.length * s * 0.5 } };
    drawStatementsOfDisagreement(page, 500, fonts, [{ statement_of_disagreement: 'We disagree with this denial.' }]);
    expect(page.drawRectangle).toHaveBeenCalledTimes(1);
    const texts = page.drawText.mock.calls.map(([t]) => t);
    expect(texts.join(' ')).toContain('STATEMENT OF DISAGREEMENT');
    expect(texts.join(' ')).toContain('We disagree with this denial.');
  });
});

describe('drawCoverPage draws any recorded statement', () => {
  test('a recorded statement appears in the cover page text when passed in', async () => {
    const drawn = [];
    const fakePage = { drawText: jest.fn((t) => drawn.push(t)), drawLine: jest.fn(), drawRectangle: jest.fn() };
    const fakeDoc = {
      addPage: jest.fn(() => fakePage),
      embedFont: jest.fn(async () => ({ widthOfTextAtSize: (t, size) => t.length * size * 0.5 })),
    };
    await drawCoverPage(fakeDoc, { first_name: 'Timmy', last_name: 'T' }, 'Acme', 'me@x.com', [
      { statement_of_disagreement: 'The session date in this record is wrong.' },
    ]);
    const text = drawn.join(' ');
    expect(text).toContain('STATEMENT OF DISAGREEMENT');
    expect(text).toContain('The session date in this record is wrong.');
  });

  test('no statement section is drawn when none are passed in', async () => {
    const drawn = [];
    const fakePage = { drawText: jest.fn((t) => drawn.push(t)), drawLine: jest.fn(), drawRectangle: jest.fn() };
    const fakeDoc = {
      addPage: jest.fn(() => fakePage),
      embedFont: jest.fn(async () => ({ widthOfTextAtSize: (t, size) => t.length * size * 0.5 })),
    };
    await drawCoverPage(fakeDoc, { first_name: 'Timmy', last_name: 'T' }, 'Acme', 'me@x.com');
    expect(drawn.join(' ')).not.toContain('STATEMENT OF DISAGREEMENT');
  });
});

describe('buildFullRecordPdf fetches and passes statements through to the cover page', () => {
  test('calls fetchStatementsOfDisagreement for this patient and still produces a valid PDF', async () => {
    getCompanyName.mockResolvedValue('Acme');
    pool.query
      .mockResolvedValueOnce({ rows: [] }) // assessments
      .mockResolvedValueOnce({ rows: [{ statement_of_disagreement: 'The session date in this record is wrong.', statement_recorded_at: '2026-10-01T00:00:00Z' }] }) // statements
      .mockResolvedValueOnce({ rows: [] }) // access history
      .mockResolvedValueOnce({ rows: [] }); // consents on file
    const { pdfBytes } = await buildFullRecordPdf({ id: 10, first_name: 'Timmy', last_name: 'T' }, 'office@x.com');
    const statementsCall = pool.query.mock.calls.find(([sql]) => /FROM correction_requests/.test(sql));
    expect(statementsCall).toBeDefined();
    expect(statementsCall[1]).toEqual([10]);
    expect(Buffer.from(pdfBytes).slice(0, 5).toString()).toBe('%PDF-');
  });
});
