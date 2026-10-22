// Builds the plain, fully-resolved data invoiceGenerator.js draws — label
// lookups, EIMS reconciliation status, tax-ID masking, and per-line totals.
// Kept separate from the generator itself so that file stays a pure
// layout function with no DB access, no decryption, and no request-scoped
// cache reads (serviceCodeLabel/locationCodeLabel/groupSizeCodeLabel read a
// per-tenant in-memory dropdown cache populated by the `protect`
// middleware, so they only work when called from a controller's request
// scope — never from deep inside PDF-drawing code).
const { decryptField } = require('./fieldEncryption');
const { serviceCodeLabel, locationCodeLabel, groupSizeCodeLabel } = require('../constants/njeis');
const { formatTime12h } = require('./formatting');

// 'INV-' + first 8 hex chars of the batch uuid, uppercased. Deliberately
// not a sequential counter (would need a new column + migration applied
// by hand across every tenant DB) — this ties 1:1 to the billing_batches
// row already used by the Invoice Status/Paid/Stamp screens, so re-issuing
// for the same batch naturally reproduces the same number, and the full
// uuid in the PDF footer stays traceable back to that row.
function formatInvoiceNumber(batchId) {
  if (!batchId) return 'INV-PENDING';
  return `INV-${String(batchId).replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

// Masks a practitioner's tax ID for display on a document that gets
// emailed. practitioners.ssn holds whichever the practitioner typed — an
// SSN (###-##-####) or an EIN (##-#######) — there's no separate EIN
// column, so this has to handle both shapes from the digit count/position
// alone rather than a stored "type" flag.
function maskTaxId(encryptedSsn) {
  const raw = decryptField(encryptedSsn) || '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 4) return '';
  const last4 = digits.slice(-4);
  // EIN is 9 digits as 2+7; SSN is 9 digits as 3+2+4. Both are 9 digits
  // once de-hyphenated, so the only signal available is the original
  // string's own hyphen position — default to SSN-shaped masking (the
  // more common case in this app) when that can't be determined.
  const looksLikeEin = /^\d{2}-\d{7}$/.test(raw.trim());
  return looksLikeEin ? `XX-XXX${last4}` : `XXX-XX-${last4}`;
}

// Prefers the structured address_line1/city/state/zip parts
// (add_practitioner_address_parts.sql) when populated; falls back to the
// legacy single `address` column for practitioners who haven't re-saved
// their profile since that migration.
function formatPractitionerAddressLines(practitioner) {
  const { address_line1, address_city, address_state, address_zip, address } = practitioner || {};
  if (address_line1) {
    const cityStateZip = [address_city, [address_state, address_zip].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', ');
    return [address_line1, cityStateZip].filter(Boolean);
  }
  return address ? [address] : [];
}

const EIMS_TIERS = {
  cleared: { fg: 'teal', bg: 'teal_bg' },
  pending: { fg: 'amber', bg: 'amber_bg' },
  exception: { fg: 'red', bg: 'red_bg' },
  unverified: { fg: 'slate', bg: 'paper' },
};

// Real per-line EIMS reconciliation status, replacing the previous
// hardcoded 'Y' — see the invoice redesign plan for the full rationale.
// Evaluated top to bottom, first match wins. `compliance` is the result of
// billingController.computeSessionCompliance(assessmentId) for agency-mode
// lines — { matched, flagged, documentOnFile, duplicateOfSessionId? } — or
// null for independent/override modes, which don't need it.
function deriveEimsStatus(assessment, { mode, compliance }) {
  // Rejected-by-admin always wins, even over an override — a human
  // explicitly said no, so this must never be paid regardless of what
  // EIMS itself says or what billing_review/is_override happen to show.
  // Checked first so it can't be shadowed by the override rule below.
  if (assessment.eims_missing_status === 'rejected') {
    return { tier: 'exception', label: 'Rejected' };
  }
  // Override mode exists specifically for logs an admin is now actively
  // approving for payment despite their earlier declined/rejected status
  // (see reportController.js's issueInvoiceOverride, which flips
  // billing_review to 'accept' before this is ever called) — tier must be
  // 'cleared' so it actually gets paid, same as the "approved but no EIMS
  // match" rule below. The "Admin override" label keeps this visible as
  // having bypassed normal EIMS verification, just not held back from
  // TOTAL DUE like a true exception.
  if (mode === 'override' || assessment.is_override) {
    return { tier: 'cleared', label: 'Override' };
  }

  // A zero-duration log is a cancelled/no-show visit, never a billable
  // session — computeSessionCompliance already treats it as auto-matched
  // (nothing to reconcile a payment against, see the comment at its own
  // zero-time short-circuit), but surfacing that as "Matched" here reads
  // as a real $0 session that needs attention, and it was pulling these
  // into the invoice's exceptions callout alongside actually-held-back
  // sessions. Tier stays 'cleared' (a $0 line changes nothing about what's
  // owed either way) but the distinct label/anomaly-free status keeps it
  // out of that callout and reads correctly as "nothing to pay here."
  if (!assessment.total_time) {
    return { tier: 'cleared', label: 'Cancelled' };
  }

  if (mode === 'independent') {
    return assessment.eims_entered_at
      ? { tier: 'cleared', label: 'Self-rep.' }
      : { tier: 'pending', label: 'Not entered' };
  }

  // Agency mode from here — compliance is required to say anything more
  // specific than "not verified".
  if (!compliance) return { tier: 'unverified', label: 'Unverified' };

  if (compliance.duplicateOfSessionId) {
    return { tier: 'exception', label: 'Duplicate', note: `Duplicate of #${compliance.duplicateOfSessionId}` };
  }
  if (!compliance.documentOnFile) {
    return { tier: 'unverified', label: 'Unverified', note: 'No state file uploaded' };
  }
  if (compliance.matched && !compliance.flagged) {
    // A field that disagreed with EIMS but was manually "Allow"-ed is
    // marked match:true/acknowledged:true by buildFieldsForSession's
    // per-log acknowledgment layer, or match:true/learnedMatch:true if a
    // PRIOR "Allow" on the same (field, state text, our value) pairing
    // turned it into a reusable rule — either way it's exactly what
    // clears `flagged` here, so this would otherwise read as a clean,
    // untouched EIMS match. A human overrode a real discrepancy (once, or
    // via a standing rule they created); the invoice should say so rather
    // than implying nothing needed a second look. Still payable (tier
    // stays 'cleared'), just labeled for what it actually is.
    const hadOverride = (compliance.fields || []).some((f) => f.acknowledged || f.learnedMatch);
    return hadOverride ? { tier: 'cleared', label: 'Exception' } : { tier: 'cleared', label: 'Matched' };
  }
  if (compliance.matched && compliance.flagged) {
    return { tier: 'pending', label: 'Mismatch' };
  }
  if (assessment.eims_missing_status === 'approved') {
    return { tier: 'cleared', label: 'Approved' };
  }
  if (assessment.eims_missing_status === 'sent_to_admin') {
    return { tier: 'pending', label: 'Awaiting' };
  }
  return { tier: 'exception', label: 'Missing' };
}

// Anomalies are separate from EIMS tier — surfaced on the line's own
// second text line and rolled into the exceptions callout, regardless of
// what the reconciliation status says. Zero duration is NOT flagged here
// — it's indistinguishable from a legitimate cancelled/no-show visit (the
// common case), which deriveEimsStatus already labels distinctly
// ("Cancelled — not billed") and deliberately keeps out of the callout;
// flagging it again here as an anomaly would put it right back in.
function deriveLineAnomalies(assessment, hours) {
  const anomalies = [];
  if (!assessment.patients?.child_id) anomalies.push('Missing child ID');
  return anomalies;
}

// Bounded-concurrency batch of computeFn(assessmentId) calls — injected
// rather than imported directly from billingController, so this module
// never creates a circular require and stays unit-testable without a DB.
// A single lookup failure must never block issuing the invoice: on error,
// that line falls back to { documentOnFile: false }, which renders as
// "Not verified" rather than aborting the whole PDF.
async function loadComplianceForLines(assessmentIds, computeFn, { concurrency = 5 } = {}) {
  const results = new Map();
  const queue = [...assessmentIds];

  async function worker() {
    while (queue.length > 0) {
      const id = queue.shift();
      try {
        results.set(id, await computeFn(id));
      } catch (err) {
        console.error(`loadComplianceForLines: compliance check failed for assessment ${id}:`, err.message);
        results.set(id, { matched: false, flagged: false, documentOnFile: false });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, assessmentIds.length) }, worker));
  return results;
}

// Same result map as loadComplianceForLines, but without a multi-query lookup
// per session: sessions are grouped by practitioner and calendar month and each
// group is answered by ONE batch analysis (the same comparison the Compliance
// Analysis tab runs). A session the batch did not cover falls back to the
// per-session check, so no line is ever left unverified by this shortcut.
// sessions: [{ id, practitioner_id, service_date }]
async function loadComplianceBatched(sessions, analyzeFn, computeFn, { concurrency = 4 } = {}) {
  const results = new Map();
  const groups = new Map();
  for (const s of sessions) {
    const month = String(s.service_date || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const key = `${s.practitioner_id}|${month}`;
    if (!groups.has(key)) groups.set(key, { practitionerId: s.practitioner_id, month, ids: [] });
    groups.get(key).ids.push(s.id);
  }
  const monthEnd = (m) => {
    const [y, mm] = m.split('-').map(Number);
    return `${m}-${String(new Date(Date.UTC(y, mm, 0)).getUTCDate()).padStart(2, '0')}`;
  };
  const queue = [...groups.values()];
  async function worker() {
    while (queue.length > 0) {
      const g = queue.shift();
      try {
        const analysis = await analyzeFn(g.practitionerId, `${g.month}-01`, monthEnd(g.month));
        for (const id of g.ids) {
          const r = analysis?.results?.[id];
          if (r) results.set(id, { ...r, documentOnFile: analysis.documentOnFile !== false });
          else if (analysis && analysis.documentOnFile === false) results.set(id, { matched: false, flagged: false, fields: [], documentOnFile: false });
        }
      } catch (err) {
        console.error(`loadComplianceBatched: analysis failed for practitioner ${g.practitionerId} ${g.month}:`, err.message);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  const missing = sessions.map((s) => s.id).filter((id) => !results.has(id));
  if (missing.length > 0) {
    const fallback = await loadComplianceForLines(missing, computeFn);
    fallback.forEach((v, k) => results.set(k, v));
  }
  return results;
}

// Maps raw assessment rows (already joined with practitioners/patients, as
// every billing query already does) into the InvoiceLine[] shape
// invoiceGenerator.js draws. Resolves service/location/group-size CODES to
// human-readable LABELS here (request-scoped cache access — see header
// comment), so the generator only ever sees plain strings.
function buildInvoiceLines(assessments, practitioner, { mode, complianceById }) {
  const rawPayRate = (practitioner?.pay_rate && parseFloat(practitioner.pay_rate) > 0)
    ? parseFloat(practitioner.pay_rate)
    : 0;

  return assessments.map((a) => {
    const hours = a.total_time ? a.total_time / 60 : 0;
    const lineTotal = Math.round(hours * rawPayRate * 100) / 100;
    const compliance = complianceById ? complianceById.get(a.id) : null;

    return {
      assessmentId: a.id,
      serviceDate: a.service_date || '',
      childName: `${a.patient_first_name || ''} ${a.patient_last_name || ''}`.trim(),
      childId: a.patients?.child_id || '',
      county: (a.patient_county || '').toUpperCase(),
      serviceCode: a.type || '',
      serviceLabel: serviceCodeLabel(a.type) || a.type || '—',
      locationLabel: locationCodeLabel(a.location) || a.location || '—',
      groupSizeLabel: groupSizeCodeLabel(a.group_size_category) || a.group_size_category || '—',
      discipline: a.practitioner_discipline || '',
      timeLabel: a.start_time && a.end_time
        ? `${formatTime12h(a.start_time)}–${formatTime12h(a.end_time)}`
        : '',
      hours,
      rate: rawPayRate,
      lineTotal,
      eims: deriveEimsStatus(a, { mode, compliance }),
      anomalies: deriveLineAnomalies(a, hours),
    };
  });
}

// TOTAL DUE only ever sums CLEARED lines — the invoice's actual enforcement
// of "don't pay for unverified sessions," not just a breakdown shown
// alongside a total that includes them anyway. Held sessions still appear
// on the invoice (with their EIMS status) for visibility, but contribute
// $0 to totalDue until a reissued invoice includes them once cleared.
function summarizeInvoiceTotals(lines) {
  const dueLines = lines.filter((l) => l.eims.tier === 'cleared');
  const heldLines = lines.filter((l) => l.eims.tier !== 'cleared');
  return {
    totalHours: lines.reduce((sum, l) => sum + l.hours, 0),
    totalDue: Math.round(dueLines.reduce((sum, l) => sum + l.lineTotal, 0) * 100) / 100,
    totalHeld: Math.round(heldLines.reduce((sum, l) => sum + l.lineTotal, 0) * 100) / 100,
    dueLines,
    heldLines,
  };
}

// Shared across all 3 invoice-issuing flows (agency, independent, override)
// — every mode brands the PDF from this same tenant-wide company_settings
// row, whether that tenant is a multi-practitioner agency or a single
// independent practitioner's own business (see the comment at
// generateSelfCertifiedSEVF's companyNameForGroup for why that's correct).
function buildBrand(companySettings) {
  const s = companySettings || {};
  const name = s.legal_entity_name || s.display_name || '';
  const contactParts = [s.address, s.phone, s.billing_email].filter(Boolean);
  return {
    name,
    logoDataUrl: s.logo || null,
    contactLine: contactParts.join(' · '),
  };
}

module.exports = {
  formatInvoiceNumber,
  maskTaxId,
  formatPractitionerAddressLines,
  deriveEimsStatus,
  deriveLineAnomalies,
  loadComplianceForLines,
  loadComplianceBatched,
  buildInvoiceLines,
  summarizeInvoiceTotals,
  buildBrand,
  EIMS_TIERS,
};
