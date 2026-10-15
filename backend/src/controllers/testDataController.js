const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { logAudit } = require('../utils/auditLog');
const { generateSignaturePng } = require('../utils/fakeSignature');

const SEED_PASSWORD = 'TestData@2026';

// Real dropdown_options codes (add_dropdown_options.sql) for the 4 base
// NJEIS categories. assessments.type holds the DISCIPLINE code (this
// category is literally named 'service_type' in the DB despite the column
// being called `type`); assessments.status holds the NJEIS visit-status
// code (what happened during the visit — "Direct Child Service", "Family
// Cancelled", etc. — despite the category being named 'service_status');
// assessments.location and .group_size_category are the other two. Storing
// a raw label instead of its code here breaks Compliance Analysis matching
// silently, since the comparison always operates on codes.
const DISCIPLINE_LABEL_TO_CODE = {
  'Evaluation': 'EV', 'Assessment': 'AS', 'IFSP Meeting': 'IFSP', 'Audiology': 'AU',
  'Developmental Intervention': 'DI', 'Family Training': 'FT', 'Health Service': 'HS',
  'Medical Service': 'MS', 'Nursing': 'NU', 'Nutrition': 'NT', 'Occupational Therapy': 'OT',
  'Physical Therapy': 'PT', 'Psychological': 'PSY', 'Speech Language Therapy': 'SLP',
  'Social Work': 'SW', 'Vision': 'VI', 'Childcare/Respite': 'CC',
  'Interpreter/Translator': 'I/T', 'Foreign Language Interpreter': 'I/T',
  'Escort/Security': 'ES', 'Transition Planning Conference': 'TPC', 'IFSP': 'IFSP', 'TPC': 'TPC',
  'Speech Therapy': 'SLP', 'Team Meetings': 'IFSP',
};
const VISIT_STATUS_LABEL_TO_CODE = {
  'Direct Child Service': '1', 'Practitioner Cancelled (inc weather related)': '2',
  'Family Cancelled (inc weather related)': '3', 'Make Up Direct Child Service': '4',
  'Makeup Direct Child Service': '4',
  'Family Missed (within 3 hours)': '5', 'Team Mtg – IFSP': 'IFSP',
  'Transition Planning Conference': 'TPC', 'Bilingual Interpretation': 'IT',
  'Makeup Bilingual Interpretation': 'IT-M', 'Family/Training/Education Service': 'FTE',
};
const LOCATION_LABEL_TO_CODE = {
  'Home': '1', 'Residential Facility': '2', 'Service Provider Clinic/Office': '3',
  'Hospital (Inpatient)': '4', 'EC Program - Children with Disabilities': '5',
  'EC Program - Inclusive Community': '6', 'DCP&P Office': '7', 'Phone/Video Conferencing': '8',
  'Telehealth': '9',
};
const GROUP_SIZE_LABEL_TO_CODE = {
  'Direct Child Service - Individual': 'individual',
  'Consultation/Facilitation with Others': 'consultation',
  'Evaluation/Assessment': 'evaluation',
};

// 1x1 transparent PNG — assessments.parent_signature/practitioner_signature
// are NOT NULL and some code paths (PDF generation) call pdfDoc.embedPng on
// them, so a placeholder needs to be a real, valid PNG rather than plain text.
const PLACEHOLDER_SIGNATURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

/**
 * POST /api/dev/seed-comparison-test-data
 * CEO-only. Body shape:
 * {
 *   practitioners: [{ email, firstName, lastName, positionTitle, payRate, serviceTypes: [] }],
 *   children: [{ childId, firstName, lastName, dob, county }],
 *   sessions: [{
 *     childId, practitionerEmail, serviceDate, startTime, endTime, totalTime,
 *     discipline (e.g. "Developmental Intervention" -> assessments.type),
 *     visitStatus (e.g. "Direct Child Service" -> assessments.status),
 *     location (e.g. "Home" -> assessments.location),
 *     groupSize (e.g. "Direct Child Service - Individual" -> group_size_category),
 *     loggedDate (YYYY-MM-DD, -> assessments.completed_at), notes
 *   }]
 * }
 *
 * Idempotent per-practitioner: only wipes and recreates the practitioners
 * actually named in THIS call's `practitioners` list (matched by email) —
 * any other previously-seeded practitioner from an earlier call (e.g. a
 * different dataset added in a separate request) is left completely
 * untouched, so multiple test datasets can accumulate across calls without
 * one wiping out another.
 */
const seedComparisonTestData = async (req, res) => {
  const { practitioners = [], children = [], sessions = [] } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Wipe only the practitioners THIS call is about to recreate
    // (assessments -> patient_practitioners -> patients -> practitioners).
    // child_id is left exactly as given (no prefix) so it can match a real
    // compliance-reference document by its real state-issued ID — so a
    // seeded patient is instead identified by being linked ONLY to seed
    // practitioners (never a real one), not by any marker on its own row.
    const incomingEmails = practitioners.map((p) => `seed-${p.email.trim().toLowerCase()}`);
    const { rows: oldPracRows } = incomingEmails.length
      ? await client.query(`SELECT id FROM practitioners WHERE email = ANY($1::text[])`, [incomingEmails])
      : { rows: [] };
    const oldPracIds = oldPracRows.map((r) => r.id);
    if (oldPracIds.length > 0) {
      const { rows: seedOnlyPatientRows } = await client.query(
        `SELECT patient_id FROM patient_practitioners
         GROUP BY patient_id
         HAVING bool_and(practitioner_id = ANY($1::int[]))`,
        [oldPracIds]
      );
      const seedOnlyPatientIds = seedOnlyPatientRows.map((r) => r.patient_id);

      // Delete by assessment_id, not just author_id — a note left by a
      // reviewing admin (not a seed practitioner) on one of these
      // assessments would otherwise survive and block the assessment delete.
      await client.query(
        `DELETE FROM assessment_notes WHERE assessment_id IN (SELECT id FROM assessments WHERE practitioner_id = ANY($1::int[]))`,
        [oldPracIds]
      );
      await client.query(
        `DELETE FROM compliance_field_acknowledgments WHERE assessment_id IN (SELECT id FROM assessments WHERE practitioner_id = ANY($1::int[]))`,
        [oldPracIds]
      );
      await client.query(`DELETE FROM assessments WHERE practitioner_id = ANY($1::int[])`, [oldPracIds]);
      await client.query(`DELETE FROM patient_practitioners WHERE practitioner_id = ANY($1::int[])`, [oldPracIds]);
      await client.query(
        `DELETE FROM billing_locks WHERE practitioner_id = ANY($1::int[]) OR locked_by = ANY($1::int[])`,
        [oldPracIds]
      );
      await client.query(`DELETE FROM billing_batches WHERE practitioner_id = ANY($1::int[])`, [oldPracIds]);
      if (seedOnlyPatientIds.length > 0) {
        // Compliance Analysis lazily backfills compliance_state_logs.patient_id
        // to point at whatever patient matches its child_id — unlink (not
        // delete) those state-reference rows so the real reference data
        // survives and can re-link to a fresh patient on the next run.
        await client.query(
          `UPDATE compliance_state_logs SET patient_id = NULL WHERE patient_id = ANY($1::int[])`,
          [seedOnlyPatientIds]
        );
        await client.query(`DELETE FROM patients WHERE id = ANY($1::int[])`, [seedOnlyPatientIds]);
      }
      await client.query(`DELETE FROM practitioners WHERE id = ANY($1::int[])`, [oldPracIds]);
    }

    // 2. Create practitioners with a real password set directly (test-only
    // shortcut — bypasses the email-invite activation flow on purpose).
    const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);
    const practitionerIdByEmail = {};
    for (const p of practitioners) {
      const seededEmail = `seed-${p.email.trim().toLowerCase()}`;
      const { rows } = await client.query(
        `INSERT INTO practitioners
           (first_name, last_name, email, password_hash, requires_password_change, role, position_title, pay_rate, service_types, is_active)
         VALUES ($1, $2, $3, $4, false, 'practitioner', $5, $6, $7, true)
         RETURNING id`,
        [
          p.firstName,
          p.lastName,
          seededEmail,
          passwordHash,
          p.positionTitle || 'Therapist',
          p.payRate || 50,
          p.serviceTypes || [],
        ]
      );
      practitionerIdByEmail[p.email.trim().toLowerCase()] = rows[0].id;
    }

    // 3. Create children (patients) + link each to every practitioner listed
    // against it in the sessions payload. A child_id can already exist from
    // an earlier seed call for a different practitioner (e.g. the same real
    // child seen by two practitioners in the spreadsheet) — ON CONFLICT DO
    // NOTHING + a follow-up SELECT reuses that existing patient row instead
    // of erroring on the UNIQUE(child_id) constraint.
    const patientIdByChildId = {};
    for (const c of children) {
      await client.query(
        `INSERT INTO patients (first_name, last_name, dob, county, child_id, status)
         VALUES ($1, $2, $3, $4, $5, 'active')
         ON CONFLICT (child_id) DO NOTHING`,
        [c.firstName, c.lastName, c.dob, c.county || 'Essex', c.childId]
      );
      const { rows } = await client.query('SELECT id FROM patients WHERE child_id = $1', [c.childId]);
      patientIdByChildId[c.childId] = rows[0].id;
    }

    const linked = new Set();
    for (const s of sessions) {
      const patientId = patientIdByChildId[s.childId];
      const practitionerId = practitionerIdByEmail[s.practitionerEmail.trim().toLowerCase()];
      const linkKey = `${patientId}:${practitionerId}`;
      if (patientId && practitionerId && !linked.has(linkKey)) {
        await client.query(
          `INSERT INTO patient_practitioners (patient_id, practitioner_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [patientId, practitionerId]
        );
        linked.add(linkKey);
      }
    }

    // 4. Create the assessments (logged sessions)
    let sessionsCreated = 0;
    for (const s of sessions) {
      const patientId = patientIdByChildId[s.childId];
      const practitionerId = practitionerIdByEmail[s.practitionerEmail.trim().toLowerCase()];
      if (!patientId || !practitionerId) continue;

      const child = children.find((c) => c.childId === s.childId);
      const prac = practitioners.find((p) => p.email.trim().toLowerCase() === s.practitionerEmail.trim().toLowerCase());

      const disciplineCode = DISCIPLINE_LABEL_TO_CODE[s.discipline] || null;
      const visitStatusCode = VISIT_STATUS_LABEL_TO_CODE[s.visitStatus] || null;
      const locationCode = s.location ? (LOCATION_LABEL_TO_CODE[s.location] || null) : null;
      const groupSizeCode = GROUP_SIZE_LABEL_TO_CODE[s.groupSize] || null;
      const completedAt = s.loggedDate ? new Date(`${s.loggedDate}T12:00:00Z`) : null;

      const { rows: insertedRows } = await client.query(
        `INSERT INTO assessments
           (patient_id, practitioner_id, patient_first_name, patient_last_name, patient_dob, patient_county,
            practitioner_first_name, practitioner_last_name, practitioner_discipline,
            service_date, start_time, end_time, total_time, status, type, location, group_size_category,
            parent_signature, practitioner_signature, form_data, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, COALESCE($21, now()))
         RETURNING id`,
        [
          patientId, practitionerId,
          child?.firstName, child?.lastName, child?.dob, child?.county || 'Essex',
          prac?.firstName, prac?.lastName, s.discipline || null,
          s.serviceDate, s.startTime || null, s.endTime || null, s.totalTime || 0,
          visitStatusCode, disciplineCode, locationCode, groupSizeCode,
          PLACEHOLDER_SIGNATURE, PLACEHOLDER_SIGNATURE,
          JSON.stringify({ custom_fields: {} }), completedAt,
        ]
      );

      if (s.notes && s.notes.trim()) {
        await client.query(
          `INSERT INTO assessment_notes (assessment_id, author_id, author_role, note)
           VALUES ($1, $2, 'practitioner', $3)`,
          [insertedRows[0].id, practitionerId, s.notes.trim()]
        );
      }

      sessionsCreated += 1;
    }

    await client.query('COMMIT');

    logAudit({
      req,
      action: 'seed_comparison_test_data',
      resourceType: 'test_data',
      details: { practitioners: practitioners.length, children: children.length, sessions: sessionsCreated },
    });

    res.json({
      success: true,
      message: 'Test data seeded successfully.',
      credentials: practitioners.map((p) => ({ email: `seed-${p.email.trim().toLowerCase()}`, password: SEED_PASSWORD })),
      counts: { practitioners: practitioners.length, children: children.length, sessions: sessionsCreated },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to seed comparison test data:', error);
    res.status(500).json({ error: 'Failed to seed test data', detail: error.message });
  } finally {
    client.release();
  }
};

/**
 * POST /api/dev/wipe-all-seed-data
 * CEO-only. Removes every practitioner ever created by seedComparisonTestData
 * (email LIKE 'seed-%') and their assessments/patient links, using the exact
 * same cascade-safe deletion steps as the per-call wipe above, just against
 * every seed practitioner instead of only the ones named in a payload.
 */
const wipeAllSeedData = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: oldPracRows } = await client.query(`SELECT id FROM practitioners WHERE email LIKE 'seed-%'`);
    const oldPracIds = oldPracRows.map((r) => r.id);

    let wipedPatients = 0;
    if (oldPracIds.length > 0) {
      const { rows: seedOnlyPatientRows } = await client.query(
        `SELECT patient_id FROM patient_practitioners
         GROUP BY patient_id
         HAVING bool_and(practitioner_id = ANY($1::int[]))`,
        [oldPracIds]
      );
      const seedOnlyPatientIds = seedOnlyPatientRows.map((r) => r.patient_id);
      wipedPatients = seedOnlyPatientIds.length;

      await client.query(
        `DELETE FROM assessment_notes WHERE assessment_id IN (SELECT id FROM assessments WHERE practitioner_id = ANY($1::int[]))`,
        [oldPracIds]
      );
      await client.query(
        `DELETE FROM compliance_field_acknowledgments WHERE assessment_id IN (SELECT id FROM assessments WHERE practitioner_id = ANY($1::int[]))`,
        [oldPracIds]
      );
      await client.query(`DELETE FROM assessments WHERE practitioner_id = ANY($1::int[])`, [oldPracIds]);
      await client.query(`DELETE FROM patient_practitioners WHERE practitioner_id = ANY($1::int[])`, [oldPracIds]);
      await client.query(
        `DELETE FROM billing_locks WHERE practitioner_id = ANY($1::int[]) OR locked_by = ANY($1::int[])`,
        [oldPracIds]
      );
      await client.query(`DELETE FROM billing_batches WHERE practitioner_id = ANY($1::int[])`, [oldPracIds]);
      if (seedOnlyPatientIds.length > 0) {
        await client.query(
          `UPDATE compliance_state_logs SET patient_id = NULL WHERE patient_id = ANY($1::int[])`,
          [seedOnlyPatientIds]
        );
        await client.query(`DELETE FROM patients WHERE id = ANY($1::int[])`, [seedOnlyPatientIds]);
      }
      await client.query(`DELETE FROM practitioners WHERE id = ANY($1::int[])`, [oldPracIds]);
    }

    await client.query('COMMIT');

    logAudit({
      req,
      action: 'wipe_all_seed_data',
      resourceType: 'test_data',
      details: { practitionersRemoved: oldPracIds.length, patientsRemoved: wipedPatients },
    });

    res.json({ success: true, practitionersRemoved: oldPracIds.length, patientsRemoved: wipedPatients });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to wipe seed data:', error);
    res.status(500).json({ error: 'Failed to wipe seed data', detail: error.message });
  } finally {
    client.release();
  }
};

/**
 * POST /api/dev/hard-delete-practitioner
 * CEO-only. Body: { practitionerId }
 *
 * A genuine hard delete — the app's own "Delete staff" action
 * (authController.deleteStaffMember) only ever soft-deactivates
 * (is_active = false), by design, matching how patient deletion was
 * removed in favor of deactivation. This is for cleaning up a manually-
 * created scratch/test account (not seed-% prefixed, so wipeAllSeedData
 * doesn't touch it) that the user wants actually gone, logs included.
 * Clears every table with a foreign key to practitioners.id before the
 * final delete, same dependencies discovered while cleaning up test data.
 */
const hardDeletePractitioner = async (req, res) => {
  const { practitionerId } = req.body;
  if (!practitionerId) return res.status(400).json({ error: 'practitionerId is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: existing } = await client.query('SELECT id, first_name, last_name FROM practitioners WHERE id = $1', [practitionerId]);
    if (!existing[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Practitioner not found' });
    }

    await client.query(
      `DELETE FROM assessment_notes WHERE assessment_id IN (SELECT id FROM assessments WHERE practitioner_id = $1) OR author_id = $1`,
      [practitionerId]
    );
    await client.query(
      `DELETE FROM compliance_field_acknowledgments WHERE assessment_id IN (SELECT id FROM assessments WHERE practitioner_id = $1) OR allowed_by = $1`,
      [practitionerId]
    );
    const { rows: deletedAssessments } = await client.query(
      'DELETE FROM assessments WHERE practitioner_id = $1 RETURNING id',
      [practitionerId]
    );
    await client.query('DELETE FROM patient_practitioners WHERE practitioner_id = $1', [practitionerId]);
    await client.query('DELETE FROM billing_locks WHERE practitioner_id = $1 OR locked_by = $1', [practitionerId]);
    await client.query('DELETE FROM billing_batches WHERE practitioner_id = $1', [practitionerId]);
    await client.query('DELETE FROM pending_contact_updates WHERE practitioner_id = $1', [practitionerId]);
    await client.query('DELETE FROM messages WHERE practitioner_id = $1 OR sender_id = $1', [practitionerId]);
    await client.query('DELETE FROM scheduled_sessions WHERE practitioner_id = $1', [practitionerId]);
    await client.query('DELETE FROM master_reports WHERE practitioner_id = $1', [practitionerId]);
    await client.query('DELETE FROM compliance_match_overrides WHERE created_by = $1', [practitionerId]);
    await client.query('DELETE FROM session_drafts WHERE practitioner_id = $1', [practitionerId]);
    await client.query('UPDATE patients SET practitioner_id = NULL WHERE practitioner_id = $1', [practitionerId]);
    // audit_logs.actor_id has ON DELETE SET NULL already — no manual cleanup needed.
    await client.query('DELETE FROM practitioners WHERE id = $1', [practitionerId]);

    await client.query('COMMIT');

    logAudit({
      req,
      action: 'hard_delete_practitioner',
      resourceType: 'practitioner',
      resourceId: practitionerId,
      details: { name: `${existing[0].first_name} ${existing[0].last_name}`, assessmentsRemoved: deletedAssessments.length },
    });

    res.json({ success: true, practitionerId, assessmentsRemoved: deletedAssessments.length });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to hard-delete practitioner:', error);
    res.status(500).json({ error: 'Failed to delete practitioner', detail: error.message });
  } finally {
    client.release();
  }
};

const STREET_NAMES = [
  'Maple Ave', 'Oak St', 'Cedar Ln', 'Elm St', 'Washington Blvd', 'Park Pl',
  'Franklin Ave', 'Lincoln St', 'Sunset Dr', 'River Rd', 'Highland Ave', 'Willow Way',
];
const NJ_CITIES = [
  { city: 'Newark', zip: '07102' }, { city: 'Camden', zip: '08102' },
  { city: 'Trenton', zip: '08608' }, { city: 'Jersey City', zip: '07302' },
  { city: 'Cherry Hill', zip: '08002' }, { city: 'Edison', zip: '08817' },
  { city: 'Paterson', zip: '07501' }, { city: 'Elizabeth', zip: '07201' },
];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomAddress = () => {
  const { city, zip } = NJ_CITIES[randInt(0, NJ_CITIES.length - 1)];
  const street = STREET_NAMES[randInt(0, STREET_NAMES.length - 1)];
  return `${randInt(100, 9999)} ${street}, ${city}, NJ ${zip}`;
};
const randomSsn = () => `${randInt(100, 899)}-${randInt(10, 99)}-${randInt(1000, 9999)}`;
const randomPhone = () => `(${randInt(200, 973)}) ${randInt(200, 999)}-${randInt(1000, 9999)}`;

/**
 * POST /api/dev/randomize-seed-practitioner-details
 * CEO-only. Assigns a random fake NJ address, SSN, and phone number to every
 * practitioner created by seedComparisonTestData (email LIKE 'seed-%') —
 * these are fake practitioners tied to anonymized/synthetic test data, so
 * fake identity fields fill out the profile for UI testing without any real
 * PII involved.
 */
const randomizeSeedPractitionerDetails = async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT id FROM practitioners WHERE email LIKE 'seed-%'`);
    for (const { id } of rows) {
      await pool.query(
        `UPDATE practitioners SET address = $1, ssn = $2, phone_number = $3 WHERE id = $4`,
        [randomAddress(), randomSsn(), randomPhone(), id]
      );
    }

    logAudit({
      req,
      action: 'randomize_seed_practitioner_details',
      resourceType: 'test_data',
      details: { practitionersUpdated: rows.length },
    });

    res.json({ success: true, practitionersUpdated: rows.length });
  } catch (error) {
    console.error('Failed to randomize seed practitioner details:', error);
    res.status(500).json({ error: 'Failed to randomize practitioner details', detail: error.message });
  }
};

/**
 * POST /api/dev/randomize-seed-signatures
 * CEO-only. Assigns a fresh, independently-random signature PNG to both
 * parent_signature and practitioner_signature on every assessment logged
 * by a seed-% practitioner, so seeded test logs don't all show the exact
 * same placeholder signature.
 */
const randomizeSeedSignatures = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id FROM assessments a
       JOIN practitioners p ON p.id = a.practitioner_id
       WHERE p.email LIKE 'seed-%'`
    );
    for (const { id } of rows) {
      await pool.query(
        `UPDATE assessments SET parent_signature = $1, practitioner_signature = $2 WHERE id = $3`,
        [generateSignaturePng(), generateSignaturePng(), id]
      );
    }

    logAudit({
      req,
      action: 'randomize_seed_signatures',
      resourceType: 'test_data',
      details: { assessmentsUpdated: rows.length },
    });

    res.json({ success: true, assessmentsUpdated: rows.length });
  } catch (error) {
    console.error('Failed to randomize seed signatures:', error);
    res.status(500).json({ error: 'Failed to randomize signatures', detail: error.message });
  }
};

// Tag written into assessments.session_notes for every row this endpoint
// creates — the only marker distinguishing generated test sessions from
// real ones on existing (non-seed-%) practitioners, since these are real
// production practitioner/patient rows, not seed-% throwaway accounts.
// wipeGeneratedLiveSessions matches on this exact prefix.
const GEN_TAG = '[GENSEPT26]';

const SERVICE_TYPE_CODES = ['DI', 'OT', 'PT', 'SLP', 'FT', 'NU', 'PSY', 'SW'];
const LOCATION_CODES = ['1', '3', '5', '6', '8'];
const GROUP_SIZE_CODES = ['individual', 'consultation'];
const VISIT_STATUS_CLEAN = '1'; // Direct Child Service

const pad2 = (n) => String(n).padStart(2, '0');
const addMinutes = (hhmm, mins) => {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + mins;
  return `${pad2(Math.floor(total / 60) % 24)}:${pad2(total % 60)}`;
};
const randomStartTime = () => `${pad2(randInt(8, 15))}:${['00', '15', '30', '45'][randInt(0, 3)]}`;
const pick = (arr) => arr[randInt(0, arr.length - 1)];

/**
 * POST /api/dev/generate-live-sessions
 * CEO-only. Generates a month of realistic session logs for a random subset
 * of the tenant's REAL, already-existing practitioners/patients (NOT seed-%
 * throwaway accounts — this writes onto the actual Izayaedge roster), with
 * a configurable fraction of sessions deliberately corrupted across 4 error
 * categories so the billing/compliance pipeline has real failures to catch
 * once a matching "EIMS export" spreadsheet is generated and uploaded
 * against the CLEAN (pre-corruption) values this endpoint returns in its
 * response manifest.
 *
 * Body: {
 *   year, month,              // e.g. 2026, 9 (1-indexed)
 *   activeFraction,           // 0..1, fraction of eligible practitioners to use (e.g. 230/393)
 *   minSessionsPerPractitioner, maxSessionsPerPractitioner,
 *   errorRate,                // 0..1, fraction of sessions to deliberately corrupt
 * }
 *
 * Eligible practitioners: role IN ('practitioner','staff'... actually just
 * 'practitioner'), is_active=true, is_platform_support=false — CEO/staff
 * accounts never get session logs. Eligible patients: status='active'.
 * Every chosen practitioner is linked (patient_practitioners) to a random
 * 2-6 child subset before logging sessions for them, if not already linked.
 *
 * Returns a manifest: for every session, its "truth" (what the state EIMS
 * export should say) and its "logged" (what actually got written to
 * assessments) — identical for clean sessions, deliberately different for
 * corrupted ones, labeled with which error category was applied. Build the
 * comparison Excel from the manifest's `truth` rows, not from re-querying
 * assessments, since the whole point is the two sources disagree.
 */
const generateLiveSessions = async (req, res) => {
  const {
    year = 2026,
    month = 9,
    activeFraction = 0.6,
    minSessionsPerPractitioner = 50,
    maxSessionsPerPractitioner = 100,
    errorRate = 0.12,
  } = req.body;

  const client = await pool.connect();
  try {
    const { rows: practitioners } = await client.query(
      `SELECT id, first_name, last_name, practitioner_discipline, pay_rate, service_types
       FROM practitioners
       WHERE role = 'practitioner' AND is_active = true AND is_platform_support = false
       ORDER BY id`
    );
    const { rows: patients } = await client.query(
      `SELECT id, first_name, last_name, dob, county, child_id FROM patients WHERE status = 'active' ORDER BY id`
    );
    if (practitioners.length === 0 || patients.length === 0) {
      return res.status(400).json({ error: 'No eligible practitioners or patients found on this tenant.' });
    }

    const activeCount = Math.max(1, Math.round(practitioners.length * activeFraction));
    const shuffled = [...practitioners].sort(() => Math.random() - 0.5);
    const activePractitioners = shuffled.slice(0, activeCount);

    const daysInMonth = new Date(year, month, 0).getDate();
    const manifest = [];
    let sessionsCreated = 0;

    await client.query('BEGIN');

    for (const prac of activePractitioners) {
      // Link this practitioner to 2-6 random children (reuse existing links
      // if any already exist) so logging stays within real ownership rules.
      const childCount = Math.min(patients.length, randInt(2, 6));
      const assignedPatients = [...patients].sort(() => Math.random() - 0.5).slice(0, childCount);
      for (const pt of assignedPatients) {
        await client.query(
          `INSERT INTO patient_practitioners (patient_id, practitioner_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [pt.id, prac.id]
        );
      }

      const sessionCount = randInt(minSessionsPerPractitioner, maxSessionsPerPractitioner);
      // Track (childId, date, startMinutes-endMinutes) to avoid generating
      // genuinely-overlapping sessions for the SAME child on the SAME day
      // under THIS practitioner, which assertNoConflictingSession-equivalent
      // logic would reject — different practitioners treating the same
      // child same day is fine (conflict scope is per-practitioner).
      const usedWindows = new Map(); // childId -> [[startMin,endMin], ...]

      for (let i = 0; i < sessionCount; i++) {
        const day = randInt(1, daysInMonth);
        const serviceDate = `${year}-${pad2(month)}-${pad2(day)}`;
        const child = pick(assignedPatients);

        const startTime = randomStartTime();
        const durationMin = pick([30, 45, 60, 60, 60, 90]);
        const endTime = addMinutes(startTime, durationMin);
        const [sh, sm] = startTime.split(':').map(Number);
        const startMin = sh * 60 + sm;
        const endMin = startMin + durationMin;
        const windowKey = `${child.id}:${serviceDate}`;
        const windows = usedWindows.get(windowKey) || [];
        const overlaps = windows.some(([s, e]) => startMin < e && endMin > s);
        if (overlaps) continue; // skip this iteration rather than fight for a free slot
        windows.push([startMin, endMin]);
        usedWindows.set(windowKey, windows);

        const serviceCode = pick(SERVICE_TYPE_CODES);
        const locationCode = pick(LOCATION_CODES);
        const groupSizeCode = pick(GROUP_SIZE_CODES);

        // "Truth" — what the state EIMS export should say for this session.
        const truth = {
          child_id: child.child_id,
          child_name: `${child.first_name} ${child.last_name}`,
          practitioner_name: `${prac.first_name} ${prac.last_name}`,
          service_date: serviceDate,
          start_time: startTime,
          end_time: endTime,
          service_code: serviceCode,
          location_code: locationCode,
          group_size_code: groupSizeCode,
          total_time: durationMin,
          logged_date: serviceDate,
        };

        // "Logged" — what actually gets written to assessments. Starts as
        // an exact copy of truth; error injection below mutates a copy.
        let logged = { ...truth };
        let errorType = null;
        let cancelled = false;
        let missingFromEims = false;
        let duplicateOf = null;
        let signatureIssue = null;
        let zeroPayRate = false;

        if (Math.random() < errorRate) {
          const categories = [
            'field_mismatch_time', 'field_mismatch_service', 'field_mismatch_location',
            'missing_from_eims', 'duplicate_eims_row',
            'signature_missing_practitioner', 'signature_missing_parent',
            'cancelled_session', 'missing_child_link', 'zero_pay_rate',
          ];
          errorType = pick(categories);

          switch (errorType) {
            case 'field_mismatch_time': {
              // Logged time drifts a few minutes from what the state has on
              // file — exercises timeWithinTolerance at the active
              // strictness profile.
              const drift = pick([-20, -15, 12, 18, 25]);
              logged.start_time = addMinutes(logged.start_time, drift);
              logged.end_time = addMinutes(logged.end_time, drift);
              break;
            }
            case 'field_mismatch_service': {
              const others = SERVICE_TYPE_CODES.filter((c) => c !== serviceCode);
              logged.service_code = pick(others);
              break;
            }
            case 'field_mismatch_location': {
              const others = LOCATION_CODES.filter((c) => c !== locationCode);
              logged.location_code = pick(others);
              break;
            }
            case 'missing_from_eims': {
              // Session gets logged normally but will simply not appear as
              // a row in the generated EIMS export — handled when building
              // the Excel (we only skip adding a row for `truth`), not here.
              missingFromEims = true;
              break;
            }
            case 'duplicate_eims_row': {
              // The EIMS export will carry this row TWICE under different
              // (fabricated) child IDs — simulated at Excel-build time via
              // the `duplicateOf` flag; the assessment itself is untouched.
              duplicateOf = true;
              break;
            }
            case 'signature_missing_practitioner':
              signatureIssue = 'practitioner';
              break;
            case 'signature_missing_parent':
              signatureIssue = 'parent';
              break;
            case 'cancelled_session':
              cancelled = true;
              logged.total_time = 0;
              break;
            case 'missing_child_link':
              // Simulated purely in the manifest for downstream reporting —
              // the real patients.child_id is never actually nulled out
              // (would break UNIQUE/NOT NULL and every other session for
              // this same child), so this category just marks the line
              // item so a reviewer can look for "would show as missing
              // child ID if it existed" — skip actual mutation.
              break;
            case 'zero_pay_rate':
              zeroPayRate = true;
              break;
            default:
              break;
          }
        }

        // assertNoConflictingSession-equivalent collision guard already
        // applied above via usedWindows; proceed to insert.
        const practitionerSig = signatureIssue === 'practitioner' ? null : generateSignaturePng();
        const parentSig = signatureIssue === 'parent' ? null : generateSignaturePng();
        // assessments.parent_signature/practitioner_signature are NOT NULL —
        // a "missing signature" error is simulated with a visibly blank 1x1
        // transparent PNG rather than an actual NULL, which the DB would
        // reject outright and which no real submission could ever produce
        // anyway (the mobile app requires a signature before submit).
        const practitionerSignature = practitionerSig || PLACEHOLDER_SIGNATURE;
        const parentSignature = parentSig || PLACEHOLDER_SIGNATURE;

        const noteParts = [GEN_TAG];
        if (errorType) noteParts.push(`err:${errorType}`);
        if (zeroPayRate) noteParts.push('zero_pay_rate');

        const { rows: insertedRows } = await client.query(
          `INSERT INTO assessments
             (patient_id, practitioner_id, patient_first_name, patient_last_name, patient_dob, patient_county,
              practitioner_first_name, practitioner_last_name, practitioner_discipline,
              service_date, start_time, end_time, total_time, status, type, location, group_size_category,
              parent_signature, practitioner_signature, form_data, session_notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
           RETURNING id`,
          [
            child.id, prac.id, child.first_name, child.last_name, child.dob, child.county,
            prac.first_name, prac.last_name, prac.practitioner_discipline || null,
            logged.service_date, cancelled ? null : logged.start_time, cancelled ? null : logged.end_time,
            cancelled ? 0 : durationMin, VISIT_STATUS_CLEAN, logged.service_code, logged.location_code, groupSizeCode,
            parentSignature, practitionerSignature, JSON.stringify({ custom_fields: {} }), noteParts.join(' '),
          ]
        );

        sessionsCreated += 1;
        manifest.push({
          assessmentId: insertedRows[0].id,
          practitionerId: prac.id,
          patientId: child.id,
          errorType,
          missingFromEims,
          duplicateOf,
          truth,
          logged,
        });

        if (zeroPayRate) {
          await client.query(`UPDATE practitioners SET pay_rate = 0 WHERE id = $1`, [prac.id]);
        }
      }
    }

    await client.query('COMMIT');

    logAudit({
      req,
      action: 'generate_live_sessions',
      resourceType: 'test_data',
      details: { practitionersUsed: activePractitioners.length, sessionsCreated, year, month, errorRate },
    });

    res.json({
      success: true,
      practitionersUsed: activePractitioners.length,
      totalPractitioners: practitioners.length,
      sessionsCreated,
      manifest,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to generate live sessions:', error);
    res.status(500).json({ error: 'Failed to generate live sessions', detail: error.message });
  } finally {
    client.release();
  }
};

/**
 * POST /api/dev/wipe-generated-live-sessions
 * CEO-only. Removes every assessment this endpoint created, identified by
 * the GEN_TAG prefix in session_notes — leaves the real practitioner/
 * patient rows themselves completely untouched (unlike wipeAllSeedData,
 * which deletes seed-% practitioners entirely), since those are real
 * existing tenant accounts, not throwaway seed accounts.
 */
const wipeGeneratedLiveSessions = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: targetRows } = await client.query(
      `SELECT id FROM assessments WHERE session_notes LIKE $1`,
      [`${GEN_TAG}%`]
    );
    const ids = targetRows.map((r) => r.id);
    if (ids.length > 0) {
      await client.query(`DELETE FROM assessment_notes WHERE assessment_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM compliance_field_acknowledgments WHERE assessment_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM assessments WHERE id = ANY($1::int[])`, [ids]);
    }
    await client.query('COMMIT');

    logAudit({ req, action: 'wipe_generated_live_sessions', resourceType: 'test_data', details: { removed: ids.length } });
    res.json({ success: true, removed: ids.length });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to wipe generated live sessions:', error);
    res.status(500).json({ error: 'Failed to wipe generated sessions', detail: error.message });
  } finally {
    client.release();
  }
};

module.exports = {
  seedComparisonTestData,
  wipeAllSeedData,
  hardDeletePractitioner,
  randomizeSeedPractitionerDetails,
  randomizeSeedSignatures,
  generateLiveSessions,
  wipeGeneratedLiveSessions,
};
