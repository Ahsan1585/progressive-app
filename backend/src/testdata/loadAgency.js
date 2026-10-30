'use strict';
// Replaces a tenant's practitioner/child/session data with the realistic agency
// from realisticAgency.js, in ONE transaction: if anything fails the tenant is
// left exactly as it was. Office accounts (ceo / staff), roles, company settings
// and dropdown options are never touched.
//
// Kept free of any HTTP so it can be run against a real database in tests and
// scripts; testDataController.js wraps it as a CEO-only endpoint.
const bcrypt = require('bcryptjs');
const { generateSignaturePng } = require('../utils/fakeSignature');
const { buildAgency } = require('./realisticAgency');
const { encryptField, hmacIndex } = require('../utils/fieldEncryption');

const SEED_PASSWORD = 'TestData@2026';
const PLACEHOLDER_SIGNATURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const DISCIPLINE_LABEL = {
  DI: 'Developmental Intervention', SLP: 'Speech Language Therapy', OT: 'Occupational Therapy',
  PT: 'Physical Therapy', SW: 'Social Work', FT: 'Family Training', EV: 'Evaluation',
  IFSP: 'IFSP Meeting', TPC: 'Transition Planning Conference',
};
const STREETS = ['Maple', 'Oak', 'Washington', 'Park', 'Lakeview', 'Highland', 'Cedar', 'Elm', 'Prospect', 'Bloomfield'];
const CITIES = ['Newark', 'Jersey City', 'Hackensack', 'Paterson', 'Montclair', 'Bayonne', 'Clifton', 'Teaneck', 'West Orange', 'Union City'];
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

// New York offset for a date (EDT between the second Sunday of March and the first of November 2026).
const nyOffset = (date) => (date >= '2026-03-08' && date < '2026-11-01' ? '-04:00' : '-05:00');

// Everything agency-side. Practitioner-owned rows that are not in the TRUNCATE
// chain are removed by id. Tenant staff accounts and settings are not listed.
async function wipeAgencyData(client) {
  const { rows } = await client.query(`SELECT id FROM practitioners WHERE role = 'practitioner'`);
  const ids = rows.map((r) => r.id);

  await client.query(
    `TRUNCATE TABLE
       assessment_notes, assessments, billing_batches, billing_invoices, billing_locks,
       compliance_field_acknowledgments, compliance_match_overrides, compliance_state_logs,
       correction_requests, master_reports, patient_agencies, patient_practitioners, patients,
       pending_contact_updates, records_releases, records_consent_requests, records_consents,
       records_inspection_requests, scheduled_sessions, session_drafts, shared_document_links,
       telepractice_signature_requests, bulk_import_batches
     RESTART IDENTITY CASCADE`
  );
  await client.query('DELETE FROM messages WHERE practitioner_id = ANY($1::int[]) OR sender_id = ANY($1::int[])', [ids]);
  await client.query('DELETE FROM practitioners WHERE id = ANY($1::int[])', [ids]);
  await client.query(
    `UPDATE company_settings SET
       compliance_doc_path = NULL, compliance_doc_filename = NULL, compliance_doc_size = NULL,
       compliance_doc_uploaded_at = NULL, compliance_doc_column_mapping = NULL,
       compliance_doc_custom_fields = '[]', compliance_doc_removed_fields = '[]',
       compliance_doc_applied_path = NULL, compliance_doc_analysis = NULL
     WHERE id = 1`
  );
  return { practitionersRemoved: ids.length };
}

async function insertAgency(client, agency) {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);
  const providerSig = new Map();
  const providerId = new Map();

  // ---- practitioners
  for (const [i, p] of agency.providers.entries()) {
    const sig = generateSignaturePng();
    providerSig.set(p.key, sig);
    const { rows } = await client.query(
      `INSERT INTO practitioners
         (first_name, last_name, email, password_hash, requires_password_change, role, position_title,
          pay_rate, service_types, is_active, address, phone_number, saved_signature, created_at)
       VALUES ($1,$2,$3,$4,false,'practitioner',$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [
        p.firstName, p.lastName, p.email, passwordHash, p.positionTitle, p.payRate, [p.discipline], !p.endDate,
        `${100 + i * 37} ${STREETS[i % STREETS.length]} St, ${CITIES[i % CITIES.length]}, NJ`,
        `201555${String(1000 + i * 13).slice(-4)}`, sig, `${p.hireDate}T09:00:00-05:00`,
      ]
    );
    providerId.set(p.key, rows[0].id);
  }

  // ---- children
  const childId = new Map();
  const parentSig = new Map();
  for (const c of agency.children) {
    const { rows } = await client.query(
      `INSERT INTO patients (first_name, last_name, dob, county, child_id, status, parent_name, parent_email, created_at, first_name_idx, last_name_idx)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        encryptField(c.firstName), encryptField(c.lastName), encryptField(c.dob), c.county, c.childId,
        c.endDate ? 'inactive' : 'active', c.parentName, c.parentEmail, `${c.startDate}T09:00:00-05:00`,
        hmacIndex(c.firstName), hmacIndex(c.lastName),
      ]
    );
    childId.set(c.key, rows[0].id);
    parentSig.set(c.key, generateSignaturePng());
  }

  // ---- care teams: who is (or was) assigned to whom
  let assignments = 0;
  for (const c of agency.children) {
    const byProvider = new Map();
    for (const svc of c.team) {
      for (const seg of svc.segments) {
        const cur = byProvider.get(seg.providerKey) || { open: false, ended: seg.to };
        if (seg.to === null) cur.open = true;
        byProvider.set(seg.providerKey, cur);
      }
    }
    for (const [pk, info] of byProvider) {
      const provider = agency.providers.find((p) => p.key === pk);
      const active = info.open && !c.endDate;
      // A provider who left and had their caseload handed on was "reassigned" by the office.
      const reassigned = !active && provider.endDate && !c.endDate;
      await client.query(
        `INSERT INTO patient_practitioners (patient_id, practitioner_id, status, deactivated_reason) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [childId.get(c.key), providerId.get(pk), active ? 'active' : 'inactive', reassigned ? 'reassigned' : null]
      );
      assignments += 1;
    }
  }

  // ---- session logs, in bulk
  const childByKey = new Map(agency.children.map((c) => [c.key, c]));
  const providerByKey = new Map(agency.providers.map((p) => [p.key, p]));
  const lateEnterers = new Set(agency.providers.filter((p) => p.errorProfile.mix.missing_in_eims >= 5).map((p) => p.key));
  let sequence = 0;
  const rows = agency.sessions.map((s) => {
    const c = childByKey.get(s.childKey);
    const p = providerByKey.get(s.providerKey);
    sequence += 1;
    // Most logs are submitted within hours; some the next morning; the late-entry provider a day or two later.
    const endClock = s.endTime || '12:00';
    const [h, m] = endClock.split(':').map(Number);
    let delayMin = 5 + (sequence * 37) % 175;
    if (sequence % 8 === 0) delayMin += 14 * 60;
    if (lateEnterers.has(s.providerKey)) delayMin += 24 * 60 * (1 + (sequence % 2));
    const done = new Date(`${s.serviceDate}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00${nyOffset(s.serviceDate)}`);
    done.setMinutes(done.getMinutes() + delayMin);
    const cancelled = s.totalMinutes === 0;
    return [
      childId.get(s.childKey), providerId.get(s.providerKey),
      encryptField(c.firstName), encryptField(c.lastName), encryptField(c.dob), c.county,
      p.firstName, p.lastName, DISCIPLINE_LABEL[s.logged.serviceCode] || DISCIPLINE_LABEL[s.serviceCode] || null,
      s.serviceDate, cancelled ? null : s.logged.startTime, cancelled ? null : s.logged.endTime, s.totalMinutes,
      s.visitStatus, s.logged.serviceCode, s.logged.location, s.groupSize,
      cancelled || s.signatureIssue === 'parent' ? PLACEHOLDER_SIGNATURE : parentSig.get(s.childKey),
      cancelled ? PLACEHOLDER_SIGNATURE : providerSig.get(s.providerKey),
      '{"custom_fields":{}}', s.notes ? encryptField(s.notes) : null, done.toISOString(),
      hmacIndex(c.firstName), hmacIndex(c.lastName),
    ];
  });
  const COLS = [
    'patient_id', 'practitioner_id', 'patient_first_name', 'patient_last_name', 'patient_dob', 'patient_county',
    'practitioner_first_name', 'practitioner_last_name', 'practitioner_discipline', 'service_date', 'start_time',
    'end_time', 'total_time', 'status', 'type', 'location', 'group_size_category', 'parent_signature',
    'practitioner_signature', 'form_data', 'session_notes', 'completed_at',
    'patient_first_name_idx', 'patient_last_name_idx',
  ];
  const insertedIds = [];
  for (const part of chunk(rows, 400)) {
    const params = [];
    const values = part.map((r, i) => {
      params.push(...r);
      return `(${r.map((_, j) => `$${i * COLS.length + j + 1}`).join(',')})`;
    });
    const res = await client.query(
      `INSERT INTO assessments (${COLS.join(',')}) VALUES ${values.join(',')} RETURNING id`,
      params
    );
    res.rows.forEach((r) => insertedIds.push(r.id));
  }

  return {
    practitioners: agency.providers.length,
    patients: agency.children.length,
    assignments,
    sessions: rows.length,
    providerIds: Object.fromEntries(providerId),
    sessionIds: insertedIds,
  };
}

async function replaceWithRealisticAgency(pool, options = {}) {
  const agency = buildAgency({ seed: options.seed, today: options.today });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const wiped = await wipeAgencyData(client);
    const loaded = await insertAgency(client, agency);
    await client.query('COMMIT');
    const { sessionIds, ...summary } = loaded;
    return { wiped, ...summary, stats: agency.stats, seed: options.seed ?? 20260101 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { replaceWithRealisticAgency, wipeAgencyData, insertAgency, SEED_PASSWORD };
