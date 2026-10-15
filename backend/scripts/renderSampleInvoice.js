// Throwaway visual-verification script for the invoice redesign — not
// wired into any npm script, run manually: node scripts/renderSampleInvoice.js
// Writes agency/independent/override sample PDFs (stamped + unstamped) to
// the OS temp dir so the layout, pagination, and PAID-stamp clearance can
// be checked by eye. Not part of the shipped feature.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { generateInvoicePDF } = require('../src/utils/invoiceGenerator');
const { stampInvoicePaid } = require('../src/utils/invoiceStamper');

const OUT_DIR = path.join(os.tmpdir(), 'invoice-redesign-samples');
fs.mkdirSync(OUT_DIR, { recursive: true });

function makeLine(i, overrides = {}) {
  const tiers = ['cleared', 'cleared', 'pending', 'exception', 'unverified'];
  const labels = { cleared: 'Matched', pending: 'Field mismatch', exception: 'Missing in EIMS', unverified: 'Not verified' };
  const tier = tiers[i % tiers.length];
  return {
    assessmentId: 1000 + i,
    serviceDate: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    childName: ['Ada Lovelace', 'José Muñoz-Ñandú', '田中 太郎', 'Grace Hopper', 'Alan Turing'][i % 5],
    childId: `C${100 + i}`,
    county: ['MERCER', 'MIDDLESEX', 'ESSEX'][i % 3],
    serviceCode: 'OT',
    serviceLabel: ['Occupational Therapy', 'Speech-Language Pathology', 'Physical Therapy'][i % 3],
    locationLabel: "Child's home",
    groupSizeLabel: 'Individual',
    discipline: 'OT',
    timeLabel: '9:00–10:00 AM',
    hours: 1,
    rate: 42.5,
    lineTotal: 42.5,
    eims: { tier, label: labels[tier] },
    anomalies: i === 3 ? ['Missing child ID'] : [],
    ...overrides,
  };
}

const brand = {
  name: 'Izayaedge - Demo',
  logoDataUrl: null,
  contactLine: '123 Main St, Trenton, NJ 08608 · (555) 123-4567 · billing@izayaedge-demo.test',
};

async function renderAndSave(name, ctx) {
  const buffer = await generateInvoicePDF(ctx);
  fs.writeFileSync(path.join(OUT_DIR, `${name}.pdf`), buffer);
  const stamped = await stampInvoicePaid(buffer);
  fs.writeFileSync(path.join(OUT_DIR, `${name}-paid.pdf`), stamped);
  console.log(`Wrote ${name}.pdf and ${name}-paid.pdf`);
}

async function main() {
  await renderAndSave('agency-small', {
    mode: 'agency',
    invoice: { number: 'INV-3F9A21C0', batchId: '3f9a21c0-88e4-4a1b-9c2d-7e6f1a0b2c3d', issuedAt: new Date(), periodStart: '2026-01-01', periodEnd: '2026-01-28' },
    brand,
    from: { title: 'FROM', name: 'Jane Practitioner', lines: ['123 Elm St, Trenton, NJ 08608', '(555) 987-6543', 'jane@example.com'] },
    billTo: { title: 'BILL TO', name: 'Izayaedge - Demo', lines: ['123 Main St, Trenton, NJ 08608', 'billing@izayaedge-demo.test'] },
    details: { discipline: 'Occupational Therapy', taxIdMasked: 'XXX-XX-6789', processedBy: 'Admin User' },
    certificationParty: 'Izayaedge - Demo',
    lines: Array.from({ length: 8 }, (_, i) => makeLine(i)),
    warnings: [],
  });

  await renderAndSave('independent-large', {
    mode: 'independent',
    invoice: { number: 'INV-AABBCCDD', batchId: 'aabbccdd-1111-2222-3333-444455556666', issuedAt: new Date(), periodStart: '2026-01-01', periodEnd: '2026-01-31' },
    brand,
    from: {
      title: 'FROM', name: 'Jane Practitioner LLC',
      lines: ['Practitioner: Jane Practitioner', '123 Elm St, Trenton, NJ 08608', '(555) 987-6543'],
    },
    billTo: { title: 'BILL TO', name: 'Sunshine Early Intervention Agency', lines: ['789 Agency Rd, Newark, NJ', 'contact@sunshine-ei.test'] },
    details: { discipline: 'Speech-Language Pathology', taxIdMasked: 'XX-XXX1234', processedBy: 'Jane Practitioner' },
    certificationParty: 'Sunshine Early Intervention Agency',
    lines: Array.from({ length: 150 }, (_, i) => makeLine(i)),
    warnings: [],
  });

  await renderAndSave('override-medium', {
    mode: 'override',
    invoice: { number: 'INV-DEADBEEF', batchId: 'deadbeef-7777-8888-9999-aaaabbbbcccc', issuedAt: new Date(), periodStart: '2026-01-01', periodEnd: '2026-01-15' },
    brand,
    from: { title: 'FROM', name: 'Jane Practitioner', lines: ['123 Elm St, Trenton, NJ 08608'] },
    billTo: { title: 'BILL TO', name: 'Izayaedge - Demo', lines: ['123 Main St, Trenton, NJ 08608'] },
    details: { discipline: 'Occupational Therapy', taxIdMasked: 'XXX-XX-6789', processedBy: 'Admin User' },
    certificationParty: 'Izayaedge - Demo',
    lines: Array.from({ length: 20 }, (_, i) => makeLine(i, { eims: { tier: 'cleared', label: 'Admin override' } })),
    warnings: ['These sessions were previously declined/rejected and are being approved for payment by admin override.'],
  });

  console.log(`\nAll samples written to: ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
