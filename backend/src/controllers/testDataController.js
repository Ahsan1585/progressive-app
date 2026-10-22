const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { logAudit } = require('../utils/auditLog');
const { generateSignaturePng } = require('../utils/fakeSignature');
const { BILLING_INVOICES_BUCKET, NJEIS_FORMS_BUCKET, deleteAllTenantFiles, listFilesDetailed, removeFiles } = require('../config/storage');
const { replaceWithRealisticAgency, SEED_PASSWORD: AGENCY_PASSWORD } = require('../testdata/loadAgency');

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

/**
 * POST /api/dev/refresh-generated-signatures
 * CEO-only. Re-draws parent_signature/practitioner_signature on every
 * [GENSEPT26]-tagged assessment using the current generateSignaturePng()
 * implementation — for re-running after that generator itself changes
 * (e.g. a visual-quality improvement), without regenerating the sessions
 * themselves. Skips any assessment whose error manifest deliberately left
 * a signature as the blank placeholder (session_notes contains
 * "err:signature_missing_practitioner" / "err:signature_missing_parent")
 * so that error category stays intact — re-signing those would silently
 * erase the deliberate test failure.
 */
const refreshGeneratedSignatures = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, session_notes FROM assessments WHERE session_notes LIKE '[GENSEPT26]%'`
    );
    let updated = 0;
    for (const { id, session_notes } of rows) {
      const skipPractitioner = (session_notes || '').includes('err:signature_missing_practitioner');
      const skipParent = (session_notes || '').includes('err:signature_missing_parent');
      if (skipPractitioner && skipParent) continue;

      const sets = [];
      const params = [];
      if (!skipParent) { params.push(generateSignaturePng()); sets.push(`parent_signature = $${params.length}`); }
      if (!skipPractitioner) { params.push(generateSignaturePng()); sets.push(`practitioner_signature = $${params.length}`); }
      if (sets.length === 0) continue;
      params.push(id);
      await pool.query(`UPDATE assessments SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
      updated += 1;
    }

    logAudit({ req, action: 'refresh_generated_signatures', resourceType: 'test_data', details: { assessmentsUpdated: updated } });
    res.json({ success: true, assessmentsUpdated: updated, totalChecked: rows.length });
  } catch (error) {
    console.error('Failed to refresh generated signatures:', error);
    res.status(500).json({ error: 'Failed to refresh signatures', detail: error.message });
  }
};

/**
 * POST /api/dev/backfill-generated-completed-at
 * CEO-only. generateLiveSessions's INSERT never set completed_at, so it
 * defaulted to now() — every [GENSEPT26]-tagged session ended up with the
 * exact same "logged at" timestamp (whenever the generator script ran),
 * instead of being spread across September the way real submissions
 * would be. Backfills completed_at to service_date plus a random
 * same-day time, so "logged today"/daily-volume dashboard views read
 * realistically against this test dataset.
 */
const backfillGeneratedCompletedAt = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE assessments
       SET completed_at = service_date::timestamptz + (random() * interval '10 hours') + interval '8 hours'
       WHERE session_notes LIKE '[GENSEPT26]%' AND service_date IS NOT NULL
       RETURNING id`
    );
    logAudit({ req, action: 'backfill_generated_completed_at', resourceType: 'test_data', details: { updated: rows.length } });
    res.json({ success: true, updated: rows.length });
  } catch (error) {
    console.error('Failed to backfill completed_at:', error);
    res.status(500).json({ error: 'Failed to backfill completed_at', detail: error.message });
  }
};

// Name pools for anonymizeTenantRoster — ordinary-sounding first/last
// names, deliberately NOT drawn from or checked against any real roster
// (this app has no way to do that anyway — each tenant is an isolated
// database). Random pairing + a shuffled draw-without-replacement order
// means no two people share a name and nothing looks sequential/
// obviously-generated like "Practitioner 001".
const DUMMY_FIRST_NAMES = [
  'Olivia', 'Liam', 'Emma', 'Noah', 'Ava', 'Ethan', 'Sophia', 'Mason',
  'Isabella', 'Lucas', 'Mia', 'Logan', 'Amelia', 'Jackson', 'Harper',
  'Aiden', 'Evelyn', 'Elijah', 'Abigail', 'Grayson', 'Emily', 'Carter',
  'Elizabeth', 'Wyatt', 'Sofia', 'Julian', 'Avery', 'Levi', 'Ella',
  'Owen', 'Scarlett', 'Daniel', 'Grace', 'Matthew', 'Chloe', 'Henry',
  'Victoria', 'Samuel', 'Riley', 'David', 'Aria', 'Joseph', 'Lily',
  'Dylan', 'Zoey', 'Isaac', 'Hannah', 'Gabriel', 'Layla', 'Anthony',
  'Nora', 'Christopher', 'Addison', 'Andrew', 'Eleanor', 'Joshua',
  'Natalie', 'Ryan', 'Lucy', 'Nathan', 'Audrey', 'Caleb', 'Zoe',
  'Leo', 'Leah', 'Hunter', 'Hazel', 'Jonathan', 'Violet', 'Eli',
  'Aurora', 'Connor', 'Savannah', 'Aaron', 'Brooklyn', 'Jaxon',
  'Bella', 'Cameron', 'Claire', 'Adrian', 'Skylar', 'Jordan', 'Lucy',
];
const DUMMY_LAST_NAMES = [
  'Bennett', 'Coleman', 'Foster', 'Reyes', 'Hayes', 'Mitchell', 'Price',
  'Barnes', 'Ross', 'Simmons', 'Harrison', 'Fisher', 'Henderson',
  'Griffin', 'Wheeler', 'Hudson', 'Marsh', 'Barrett', 'Lambert',
  'Pearson', 'Chapman', 'Dunn', 'Hart', 'Fleming', 'Stokes', 'Norris',
  'Sutton', 'Mckenzie', 'Lane', 'Mccarthy', 'Day', 'Holt', 'Boone',
  'Vance', 'Tate', 'Goodwin', 'Sharp', 'Chase', 'Hobbs', 'Pruitt',
  'Flowers', 'Dawson', 'Bishop', 'Cross', 'Shepherd', 'Mercer',
  'Pratt', 'Doyle', 'Osborn', 'Rhodes', 'Winters', 'Snyder', 'Case',
  'Nolan', 'Beck', 'Weaver', 'Mcdaniel', 'Strickland', 'Fitzgerald',
  'Buckley', 'Whitfield', 'Benton', 'Dillon', 'Calloway', 'Everson',
  'Hargrove', 'Kessler', 'Lindgren', 'Morrow', 'Osgood', 'Redmond',
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * POST /api/dev/anonymize-tenant-roster
 * CEO-only. Renames every practitioner (role='practitioner', excluding
 * the caller's own CEO/staff accounts and is_platform_support rows) and
 * every patient on this tenant to a random, ordinary-sounding dummy name
 * — not drawn from or checked against any real data (impossible anyway,
 * since each tenant is an isolated database), just an unremarkable name
 * pool shuffled into non-sequential pairs so nothing looks generated.
 *
 * Also rewrites every DENORMALIZED name snapshot so historical records
 * show the new names too, not just the master practitioners/patients
 * rows: assessments.patient_first_name/patient_last_name/
 * practitioner_first_name/practitioner_last_name,
 * compliance_state_logs.child_name/practitioner_name (the uploaded EIMS
 * export's own cached names), and master_reports.child_name. Without
 * this, every session log and generated report would keep showing the
 * old names even after the roster itself was renamed.
 */
const anonymizeTenantRoster = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: practitioners } = await client.query(
      `SELECT id, first_name, last_name FROM practitioners
       WHERE role = 'practitioner' AND is_platform_support = false`
    );
    const { rows: patients } = await client.query(`SELECT id, first_name, last_name FROM patients`);

    const firstPool = shuffle(DUMMY_FIRST_NAMES);
    const lastPool = shuffle(DUMMY_LAST_NAMES);
    const needed = practitioners.length + patients.length;
    // Cycle the shuffled pools if there are more people than names in the
    // pool — still non-sequential since first/last are drawn from
    // independently-shuffled, independently-cycling pools.
    const nameAt = (pool, i) => pool[i % pool.length];

    const practitionerRenames = practitioners.map((p, i) => ({
      id: p.id,
      oldFirst: p.first_name,
      oldLast: p.last_name,
      newFirst: nameAt(firstPool, i),
      newLast: nameAt(lastPool, i),
    }));
    const patientRenames = patients.map((p, i) => ({
      id: p.id,
      oldFirst: p.first_name,
      oldLast: p.last_name,
      newFirst: nameAt(firstPool, practitioners.length + i),
      newLast: nameAt(lastPool, practitioners.length + i),
    }));

    for (const r of practitionerRenames) {
      await client.query('UPDATE practitioners SET first_name = $1, last_name = $2 WHERE id = $3', [r.newFirst, r.newLast, r.id]);
      await client.query(
        `UPDATE assessments SET practitioner_first_name = $1, practitioner_last_name = $2 WHERE practitioner_id = $3`,
        [r.newFirst, r.newLast, r.id]
      );
    }
    for (const r of patientRenames) {
      await client.query('UPDATE patients SET first_name = $1, last_name = $2 WHERE id = $3', [r.newFirst, r.newLast, r.id]);
      await client.query(
        `UPDATE assessments SET patient_first_name = $1, patient_last_name = $2 WHERE patient_id = $3`,
        [r.newFirst, r.newLast, r.id]
      );
    }

    // compliance_state_logs and master_reports store names as free text
    // (child_name/practitioner_name), not foreign keys — rewrite by
    // matching the OLD full name string, since that's the only link back
    // to who they belonged to.
    for (const r of practitionerRenames) {
      const oldFull = `${r.oldFirst} ${r.oldLast}`;
      const newFull = `${r.newFirst} ${r.newLast}`;
      await client.query(`UPDATE compliance_state_logs SET practitioner_name = $1 WHERE practitioner_name = $2`, [newFull, oldFull]);
    }
    for (const r of patientRenames) {
      const oldFull = `${r.oldFirst} ${r.oldLast}`;
      const newFull = `${r.newFirst} ${r.newLast}`;
      await client.query(`UPDATE compliance_state_logs SET child_name = $1 WHERE child_name = $2`, [newFull, oldFull]);
      await client.query(`UPDATE master_reports SET child_name = $1 WHERE child_name = $2`, [newFull, oldFull]);
    }

    await client.query('COMMIT');

    logAudit({
      req, action: 'anonymize_tenant_roster', resourceType: 'test_data',
      details: { practitionersRenamed: practitionerRenames.length, patientsRenamed: patientRenames.length },
    });
    res.json({
      success: true,
      practitionersRenamed: practitionerRenames.length,
      patientsRenamed: patientRenames.length,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to anonymize tenant roster:', error);
    res.status(500).json({ error: 'Failed to anonymize roster', detail: error.message });
  } finally {
    client.release();
  }
};

/**
 * POST /api/dev/wipe-tenant-roster-completely
 * CEO-only. Full clean-slate wipe: deletes EVERY practitioner with
 * role='practitioner' (any role, any origin — not scoped to seed-% or
 * [GENSEPT26]-tagged rows like the other wipe endpoints), every patient,
 * every assessment, and every dependent record across the same FK chain
 * hardDeletePractitioner already established per-practitioner, run here
 * set-wide in one transaction. CEO/staff accounts (role IN ('ceo','staff'))
 * are preserved so there's still a way to log in afterward. Also clears
 * the uploaded compliance doc (company_settings' compliance_doc_* columns)
 * and compliance_state_logs, since a from-scratch rebuild needs a fresh
 * EIMS reference file, not a doc still describing the deleted roster.
 *
 * Irreversible — there is no soft-delete/undo here, by design (this is
 * the "start over" endpoint, used once the existing data is deemed
 * unusable rather than something to incrementally fix).
 */
const wipeTenantRosterCompletely = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: pracIdRows } = await client.query(`SELECT id FROM practitioners WHERE role = 'practitioner'`);
    const practitionerIds = pracIdRows.map((r) => r.id);
    const { rows: patientIdRows } = await client.query(`SELECT id FROM patients`);
    const patientIds = patientIdRows.map((r) => r.id);

    await client.query(
      `DELETE FROM assessment_notes WHERE assessment_id IN (SELECT id FROM assessments WHERE practitioner_id = ANY($1::int[])) OR author_id = ANY($1::int[])`,
      [practitionerIds]
    );
    await client.query(
      `DELETE FROM compliance_field_acknowledgments WHERE assessment_id IN (SELECT id FROM assessments WHERE practitioner_id = ANY($1::int[])) OR allowed_by = ANY($1::int[])`,
      [practitionerIds]
    );
    // telepractice_signature_requests.assessment_id/practitioner_id/
    // patient_id all reference these rows with no ON DELETE cascade —
    // must go before assessments/practitioners/patients or the delete
    // below fails on an FK violation (found via a real failed wipe
    // attempt, not present in hardDeletePractitioner's original
    // checklist since this table was added after that function).
    await client.query(
      `DELETE FROM telepractice_signature_requests WHERE practitioner_id = ANY($1::int[]) OR patient_id = ANY($2::int[])`,
      [practitionerIds, patientIds]
    );
    const { rows: deletedAssessments } = await client.query(
      `DELETE FROM assessments WHERE practitioner_id = ANY($1::int[]) RETURNING id`,
      [practitionerIds]
    );
    await client.query(`DELETE FROM patient_practitioners WHERE practitioner_id = ANY($1::int[])`, [practitionerIds]);
    await client.query(`DELETE FROM billing_locks WHERE practitioner_id = ANY($1::int[]) OR locked_by = ANY($1::int[])`, [practitionerIds]);
    await client.query(`DELETE FROM billing_batches WHERE practitioner_id = ANY($1::int[])`, [practitionerIds]);
    await client.query(`DELETE FROM pending_contact_updates WHERE practitioner_id = ANY($1::int[])`, [practitionerIds]);
    await client.query(`DELETE FROM messages WHERE practitioner_id = ANY($1::int[]) OR sender_id = ANY($1::int[])`, [practitionerIds]);
    await client.query(`DELETE FROM scheduled_sessions WHERE practitioner_id = ANY($1::int[])`, [practitionerIds]);
    await client.query(`DELETE FROM master_reports WHERE practitioner_id = ANY($1::int[])`, [practitionerIds]);
    await client.query(`DELETE FROM compliance_match_overrides WHERE created_by = ANY($1::int[])`, [practitionerIds]);
    await client.query(`DELETE FROM session_drafts WHERE practitioner_id = ANY($1::int[])`, [practitionerIds]);
    // agencies/patient_agencies cascade on practitioner_id/patient_id delete
    // (add_agencies.sql) — no manual cleanup needed for those two.
    // bulk_import_batches.created_by has no cascade — SET NULL rather than
    // block the wipe if a deleted practitioner ever ran a bulk import
    // (unlikely in practice, but the FK is there).
    await client.query(`UPDATE bulk_import_batches SET created_by = NULL WHERE created_by = ANY($1::int[])`, [practitionerIds]);
    await client.query(`UPDATE patients SET practitioner_id = NULL WHERE practitioner_id = ANY($1::int[])`, [practitionerIds]);
    // compliance_state_logs.patient_id references patients(id) with no
    // cascade — must clear before deleting patients, not after (found via
    // a real failed wipe attempt: deleting patients first throws an FK
    // violation here).
    await client.query(`DELETE FROM compliance_state_logs`);
    await client.query(`DELETE FROM patients WHERE id = ANY($1::int[])`, [patientIds]);
    await client.query(`DELETE FROM practitioners WHERE id = ANY($1::int[])`, [practitionerIds]);
    await client.query(
      `UPDATE company_settings SET
         compliance_doc_path = NULL, compliance_doc_filename = NULL, compliance_doc_size = NULL,
         compliance_doc_uploaded_at = NULL, compliance_doc_column_mapping = NULL,
         compliance_doc_custom_fields = '[]', compliance_doc_removed_fields = '[]',
         compliance_doc_applied_path = NULL, compliance_doc_analysis = NULL
       WHERE id = 1`
    );

    await client.query('COMMIT');

    // GCS cleanup runs AFTER the DB commit, not inside the transaction —
    // a storage failure here must never roll back an already-successful
    // DB wipe. Without this, every SEVF/invoice PDF ever generated for
    // the deleted roster keeps sitting in the bucket and getting listed
    // as "Completed Bills" history (getInvoiceHistory lists files by
    // scanning storage, not by querying billing_batches), showing
    // phantom rows for practitioners that no longer exist, with no real
    // batch behind them to act on (ACTIONS column has nothing to show).
    let filesDeleted = true;
    try {
      await deleteAllTenantFiles(BILLING_INVOICES_BUCKET);
      await deleteAllTenantFiles(NJEIS_FORMS_BUCKET);
    } catch (storageError) {
      filesDeleted = false;
      console.error('wipeTenantRosterCompletely: GCS cleanup failed (DB wipe already committed):', storageError.message);
    }

    logAudit({
      req, action: 'wipe_tenant_roster_completely', resourceType: 'test_data',
      details: { practitionersRemoved: practitionerIds.length, patientsRemoved: patientIds.length, assessmentsRemoved: deletedAssessments.length, filesDeleted },
    });
    res.json({
      success: true,
      practitionersRemoved: practitionerIds.length,
      patientsRemoved: patientIds.length,
      assessmentsRemoved: deletedAssessments.length,
      filesDeleted,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to wipe tenant roster completely:', error);
    res.status(500).json({ error: 'Failed to wipe tenant roster', detail: error.message });
  } finally {
    client.release();
  }
};

const NJ_COUNTIES = [
  'Essex', 'Bergen', 'Hudson', 'Middlesex', 'Union', 'Mercer',
  'Camden', 'Monmouth', 'Ocean', 'Passaic', 'Burlington', 'Morris',
];
const DISCIPLINE_POSITION_TITLES = {
  DI: 'Developmental Interventionist', OT: 'Occupational Therapist', PT: 'Physical Therapist',
  SLP: 'Speech Language Pathologist', FT: 'Family Trainer', NU: 'Nurse',
  PSY: 'Psychologist', SW: 'Social Worker',
};
const PRACTITIONER_SERVICE_TYPES = ['DI', 'OT', 'PT', 'SLP', 'FT', 'NU', 'PSY', 'SW'];
const PAY_RATE_BY_DISCIPLINE = { DI: 60, OT: 85, PT: 85, SLP: 90, FT: 55, NU: 70, PSY: 95, SW: 65 };
const randomDob = () => {
  const today = new Date();
  const ageMonths = randInt(4, 35); // under-3 EI eligibility window
  const d = new Date(today.getFullYear(), today.getMonth() - ageMonths, randInt(1, 28));
  return d.toISOString().slice(0, 10);
};

/**
 * POST /api/dev/create-dummy-roster
 * CEO-only. Creates N dummy practitioners and M dummy patients from
 * scratch on this tenant — the counterpart to wipeTenantRosterCompletely,
 * for rebuilding a roster after a full wipe rather than generating
 * sessions against whatever already happens to exist (generateLiveSessions
 * requires the roster to already be there; this is what creates it).
 * Reuses the same dummy name pools as anonymizeTenantRoster so naming
 * stays consistent across both tools.
 *
 * Body: { practitionerCount = 300, patientCount = 45 }
 */
const createDummyRoster = async (req, res) => {
  const { practitionerCount = 300, patientCount = 45 } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const firstPool = shuffle(DUMMY_FIRST_NAMES);
    const lastPool = shuffle(DUMMY_LAST_NAMES);
    const nameAt = (pool, i) => pool[i % pool.length];
    const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

    const createdPractitioners = [];
    for (let i = 0; i < practitionerCount; i++) {
      const firstName = nameAt(firstPool, i);
      const lastName = nameAt(lastPool, i);
      const discipline = PRACTITIONER_SERVICE_TYPES[i % PRACTITIONER_SERVICE_TYPES.length];
      const email = `dummy.practitioner.${i + 1}@izayaedge-demo.test`;
      const { rows } = await client.query(
        `INSERT INTO practitioners
           (first_name, last_name, email, password_hash, requires_password_change, role, position_title, pay_rate, service_types, is_active, address, phone_number)
         VALUES ($1,$2,$3,$4,false,'practitioner',$5,$6,$7,true,$8,$9)
         RETURNING id`,
        [
          firstName, lastName, email, passwordHash,
          DISCIPLINE_POSITION_TITLES[discipline], PAY_RATE_BY_DISCIPLINE[discipline], [discipline],
          randomAddress(), randomPhone(),
        ]
      );
      createdPractitioners.push({ id: rows[0].id, firstName, lastName, discipline });
    }

    const createdPatients = [];
    // 10-digit-looking child IDs, prefixed distinctly from any prior
    // dataset's 900000xxx/800000xxx range so a fresh rebuild's IDs never
    // collide with anything a previous generation pass might have left
    // behind (e.g. in compliance_state_logs rows from an earlier upload).
    for (let i = 0; i < patientCount; i++) {
      const firstName = nameAt(firstPool, practitionerCount + i);
      const lastName = nameAt(lastPool, practitionerCount + i);
      const childId = `70000${String(i + 1).padStart(4, '0')}`;
      const { rows } = await client.query(
        `INSERT INTO patients (first_name, last_name, dob, county, child_id, status)
         VALUES ($1,$2,$3,$4,$5,'active')
         RETURNING id`,
        [firstName, lastName, randomDob(), NJ_COUNTIES[i % NJ_COUNTIES.length], childId]
      );
      createdPatients.push({ id: rows[0].id, firstName, lastName, childId });
    }

    await client.query('COMMIT');

    logAudit({
      req, action: 'create_dummy_roster', resourceType: 'test_data',
      details: { practitionersCreated: createdPractitioners.length, patientsCreated: createdPatients.length },
    });
    res.json({
      success: true,
      practitionersCreated: createdPractitioners.length,
      patientsCreated: createdPatients.length,
      credentials: { emailPattern: 'dummy.practitioner.<n>@izayaedge-demo.test', password: SEED_PASSWORD },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to create dummy roster:', error);
    res.status(500).json({ error: 'Failed to create dummy roster', detail: error.message });
  } finally {
    client.release();
  }
};

/**
 * POST /api/dev/fix-generator-zeroed-pay-rates
 * CEO-only, one-off repair tool for the generateLiveSessions bug where
 * the zero_pay_rate error category re-rolled per SESSION instead of per
 * practitioner, zeroing out ~48% of a roster's pay_rate instead of the
 * intended ~5%. Restores every [service_types-tagged] practitioner
 * currently at pay_rate = 0 to the discipline-based rate
 * (PAY_RATE_BY_DISCIPLINE), using service_types[0] — untouched by the bug
 * — to recover their real discipline, then re-rolls a fresh ~5% sample
 * back down to 0 so the dataset still has a few genuine zero-rate cases
 * to exercise the "no pay rate set" warning, same intent as the fixed
 * generator now produces on a clean run.
 */
const fixGeneratorZeroedPayRates = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: zeroRateRows } = await client.query(
      `SELECT id, service_types FROM practitioners WHERE role = 'practitioner' AND pay_rate = 0`
    );

    let restored = 0;
    for (const p of zeroRateRows) {
      const discipline = (p.service_types || [])[0];
      const rate = PAY_RATE_BY_DISCIPLINE[discipline];
      if (!rate) continue; // no recoverable discipline — leave as-is rather than guess
      await client.query('UPDATE practitioners SET pay_rate = $1 WHERE id = $2', [rate, p.id]);
      restored += 1;
    }

    // Re-roll a fresh ~5% sample back to zero, matching what a clean run
    // of the fixed generator would have produced.
    const { rows: allPracRows } = await client.query(`SELECT id FROM practitioners WHERE role = 'practitioner'`);
    const reZeroed = allPracRows.filter(() => Math.random() < 0.05);
    for (const p of reZeroed) {
      await client.query('UPDATE practitioners SET pay_rate = 0 WHERE id = $1', [p.id]);
    }

    await client.query('COMMIT');

    logAudit({
      req, action: 'fix_generator_zeroed_pay_rates', resourceType: 'test_data',
      details: { restored, reZeroed: reZeroed.length },
    });
    res.json({ success: true, restored, reZeroed: reZeroed.length });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to fix zeroed pay rates:', error);
    res.status(500).json({ error: 'Failed to fix zeroed pay rates', detail: error.message });
  } finally {
    client.release();
  }
};

/**
 * POST /api/dev/cleanup-orphaned-billing-files
 * CEO-only. getInvoiceHistory (the "Completed Bills" tab) lists SEVF/
 * invoice history by scanning every PDF under this tenant's storage
 * prefix — it has no DB cross-check. A full roster wipe (wipeTenantRoster
 * Completely) deletes the billing_batches/assessments rows but, before
 * this endpoint existed, left every previously-generated PDF sitting in
 * storage, so old (now practitioner-less) batches kept showing up as
 * phantom "Completed Bills" rows with working downloads but no real
 * batch behind them (ACTIONS column has nothing to show for them).
 *
 * Surgical, not a full-bucket wipe (that's deleteAllTenantFiles, used by
 * wipeTenantRosterCompletely itself, which is safe there because that
 * endpoint also deletes every practitioner unconditionally — no survivor
 * case to worry about). Here, practitioners already exist again after a
 * rebuild, so this only deletes files whose path's practitioner-name
 * folder segment (YYYY-MM/First_Last/...) doesn't match any
 * CURRENTLY-active practitioner's own name — never touches a file that
 * could belong to someone on the roster right now.
 */
const cleanupOrphanedBillingFiles = async (req, res) => {
  try {
    const { rows: practitioners } = await pool.query(
      `SELECT first_name, last_name FROM practitioners WHERE role = 'practitioner'`
    );
    const validFolders = new Set(
      practitioners.map((p) => `${p.first_name}_${p.last_name}`.replace(/\s+/g, '_'))
    );

    const deletedPaths = [];
    for (const bucketName of [BILLING_INVOICES_BUCKET, NJEIS_FORMS_BUCKET]) {
      const files = await listFilesDetailed(bucketName, '');
      const orphaned = files
        .map((f) => f.name)
        .filter((name) => {
          // Expected shape: YYYY-MM/Practitioner_Name/File.pdf
          const parts = name.split('/');
          if (parts.length < 2) return false; // not a recognized billing-doc path — leave alone
          const folder = parts[1];
          return !validFolders.has(folder);
        });
      if (orphaned.length > 0) {
        await removeFiles(bucketName, orphaned);
        deletedPaths.push(...orphaned.map((p) => `${bucketName}/${p}`));
      }
    }

    logAudit({ req, action: 'cleanup_orphaned_billing_files', resourceType: 'test_data', details: { deleted: deletedPaths.length } });
    res.json({ success: true, deleted: deletedPaths.length, samplePaths: deletedPaths.slice(0, 10) });
  } catch (error) {
    console.error('Failed to clean up orphaned billing files:', error);
    res.status(500).json({ error: 'Failed to clean up orphaned billing files', detail: error.message });
  }
};

// Tag written into assessments.session_notes for every row this endpoint
// creates — the only marker distinguishing generated test sessions from
// real ones on existing (non-seed-%) practitioners, since these are real
// production practitioner/patient rows, not seed-% throwaway accounts.
// wipeGeneratedLiveSessions matches on this exact prefix.
const GEN_TAG = '[GENSEPT26]';

const SERVICE_TYPE_CODES = ['DI', 'OT', 'PT', 'SLP', 'FT', 'NU', 'PSY', 'SW'];
const SERVICE_TYPE_DISCIPLINE_LABEL = {
  DI: 'Developmental Intervention', OT: 'Occupational Therapy', PT: 'Physical Therapy',
  SLP: 'Speech Language Therapy', FT: 'Family Training', NU: 'Nursing',
  PSY: 'Psychological', SW: 'Social Work',
};
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
    // With a realistic 1-4-practitioner care-team cap per child (see
    // CHILD_CARE_TEAM_CAP below) and a small patient pool, only so many
    // practitioners can realistically have an active caseload at once —
    // a high activeFraction here just starves later practitioners of any
    // available children. 0.15 keeps the "active roster" a plausible size
    // relative to the patient pool instead of maximizing headcount.
    activeFraction = 0.15,
    // A real EI practitioner's monthly caseload is nowhere near 50-100
    // sessions (that's 2-5+ visits every single workday) — 12-30/month is
    // realistic for a typical part-time-to-full-time caseload across a
    // handful of children seen 1-4x/week each. The old 50-100 default,
    // combined with a large active-practitioner count, is what produced
    // 15,000+ sessions in a single month on a 45-patient tenant.
    minSessionsPerPractitioner = 12,
    maxSessionsPerPractitioner = 30,
    errorRate = 0.12,
  } = req.body;

  const client = await pool.connect();
  try {
    const { rows: practitioners } = await client.query(
      `SELECT id, first_name, last_name, position_title, pay_rate, service_types
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

    // Real EI care: a child has a small, fixed care team (typically 1-4
    // practitioners across disciplines), never dozens. Picking children
    // independently and uniformly at random per practitioner (as this used
    // to do) produces birthday-paradox clustering — with ~300 practitioners
    // drawing from a small patient pool, a handful of children end up
    // linked to dozens of practitioners purely by chance. Each child gets a
    // realistic cap (1-4) fixed once up front, and the per-practitioner
    // picker below only draws from children still under their own cap.
    const CHILD_CARE_TEAM_CAP = new Map(patients.map((p) => [p.id, randInt(1, 4)]));
    const childAssignmentCount = new Map(patients.map((p) => [p.id, 0]));

    await client.query('BEGIN');

    for (const prac of activePractitioners) {
      // zero_pay_rate is a PRACTITIONER-level condition (a misconfigured
      // rate), not a per-session one — decided once per practitioner here,
      // not re-rolled on every session, which previously zeroed out the
      // rate on ~48% of the roster (any practitioner with enough sessions
      // had a near-certain chance of rolling it at least once, and each
      // roll re-zeroed the same already-$0 row). ~5% of practitioners end
      // up with a $0 rate — enough to exercise the dashboard's/invoice's
      // "no pay rate set" warning without corrupting half the dataset.
      const hasZeroPayRate = Math.random() < 0.05;
      if (hasZeroPayRate) {
        await client.query(`UPDATE practitioners SET pay_rate = 0 WHERE id = $1`, [prac.id]);
      }

      // Per-practitioner error-proneness multiplier applied to the base
      // errorRate below — without this, every session rolls the exact same
      // flat probability, and with enough sessions per practitioner the law
      // of large numbers converges everyone to nearly the same error count
      // (e.g. "3 flagged / 1 missing" across the whole roster), which reads
      // as obviously fake/repetitive rather than real-world variance. Real
      // agencies have a skewed distribution: most practitioners are careful
      // (well below the base rate), a meaningful minority are average, and
      // a small tail is genuinely sloppy (multiple times the base rate) —
      // approximated here with a log-normal-ish draw (squaring a uniform
      // random skews the mass toward the low end, with an occasional spike).
      const practitionerErrorMultiplier = 0.15 + 2.5 * Math.pow(Math.random(), 2);

      // Which error categories THIS practitioner tends toward — real
      // sloppiness clusters (one practitioner is consistently weak on
      // documenting location, another always has signature issues), it
      // doesn't roll uniformly across every category every time. 2-4
      // categories picked per practitioner, weighted 3x over the full set
      // when an error does occur, so most of their errors come from their
      // own "weak spots" with an occasional category outside that set.
      const ALL_ERROR_CATEGORIES = [
        'field_mismatch_time', 'field_mismatch_service', 'field_mismatch_location',
        'missing_from_eims', 'duplicate_eims_row',
        'signature_missing_practitioner', 'signature_missing_parent',
        'cancelled_session', 'missing_child_link',
      ];
      const weakSpotCount = randInt(2, 4);
      const practitionerWeakSpots = [...ALL_ERROR_CATEGORIES].sort(() => Math.random() - 0.5).slice(0, weakSpotCount);
      const weightedCategoryPool = [
        ...practitionerWeakSpots, ...practitionerWeakSpots, ...practitionerWeakSpots,
        ...ALL_ERROR_CATEGORIES,
      ];

      // Link this practitioner to 2-6 children, preferring children who
      // haven't yet hit their fixed care-team cap (CHILD_CARE_TEAM_CAP
      // above) — keeps every child's total practitioner count realistic
      // instead of a handful of children ending up linked to dozens. Falls
      // back to the full patient pool if every child is already at cap
      // (a small patient pool + many active practitioners can exhaust
      // under-cap children before everyone's been assigned) — a
      // practitioner left with zero children entirely would crash the
      // session loop below, which is worse than occasionally exceeding
      // the soft cap by one practitioner.
      const underCapChildren = patients.filter((p) => childAssignmentCount.get(p.id) < CHILD_CARE_TEAM_CAP.get(p.id));
      const childPool = underCapChildren.length > 0 ? underCapChildren : patients;
      const childCount = Math.min(childPool.length, randInt(2, 6));
      const assignedPatients = [...childPool].sort(() => Math.random() - 0.5).slice(0, childCount);
      for (const pt of assignedPatients) {
        await client.query(
          `INSERT INTO patient_practitioners (patient_id, practitioner_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [pt.id, prac.id]
        );
        childAssignmentCount.set(pt.id, childAssignmentCount.get(pt.id) + 1);
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

        if (Math.random() < errorRate * practitionerErrorMultiplier) {
          errorType = pick(weightedCategoryPool);

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
        if (hasZeroPayRate) noteParts.push('zero_pay_rate');

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
            prac.first_name, prac.last_name, SERVICE_TYPE_DISCIPLINE_LABEL[serviceCode] || null,
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

// The phrase a caller must send to confirm the replace, so it cannot fire by accident.
const CONFIRM_PHRASE = 'REPLACE-AGENCY-DATA';

/**
 * POST /api/dev/reset-to-realistic-agency   { confirm: 'REPLACE-AGENCY-DATA', seed?, today? }
 * CEO-only, and only mounted when ENABLE_TEST_SEED=true. DESTRUCTIVE: deletes every
 * generated practitioner, child, session, billing batch, consent and EIMS state record on
 * this tenant and loads the realistic small-agency dataset (see testdata/realisticAgency.js)
 * in its place, in one transaction. Office accounts (ceo / staff), roles, company settings
 * and dropdown options are kept. Stored invoice/SEVF files are removed from cloud storage
 * only AFTER the database commit succeeds, so a failed load never strands the tenant
 * without its files.
 */
const resetToRealisticAgency = async (req, res) => {
  if ((req.body || {}).confirm !== CONFIRM_PHRASE) {
    return res.status(400).json({ error: `This replaces all agency data. Send { "confirm": "${CONFIRM_PHRASE}" } to proceed.` });
  }
  const { seed, today } = req.body;
  try {
    const result = await replaceWithRealisticAgency(pool, { seed, today });

    let filesDeleted = true;
    try {
      await deleteAllTenantFiles(BILLING_INVOICES_BUCKET);
      await deleteAllTenantFiles(NJEIS_FORMS_BUCKET);
    } catch (storageError) {
      filesDeleted = false;
      console.error('resetToRealisticAgency: storage cleanup failed (database load already committed):', storageError.message);
    }

    logAudit({
      req, action: 'reset_to_realistic_agency', resourceType: 'test_data',
      details: { practitioners: result.practitioners, patients: result.patients, sessions: result.sessions, wiped: result.wiped, filesDeleted },
    });
    res.json({
      success: true,
      ...result,
      filesDeleted,
      credentials: { emailPattern: 'first.last@izayaedge-demo.test', password: AGENCY_PASSWORD },
    });
  } catch (error) {
    console.error('Failed to reset to realistic agency:', error);
    res.status(500).json({ error: 'Failed to load the realistic agency; the database was rolled back.', detail: error.message });
  }
};

module.exports = {
  resetToRealisticAgency,
  CONFIRM_PHRASE,
  seedComparisonTestData,
  wipeAllSeedData,
  hardDeletePractitioner,
  randomizeSeedPractitionerDetails,
  randomizeSeedSignatures,
  generateLiveSessions,
  wipeGeneratedLiveSessions,
  refreshGeneratedSignatures,
  backfillGeneratedCompletedAt,
  anonymizeTenantRoster,
  wipeTenantRosterCompletely,
  createDummyRoster,
  fixGeneratorZeroedPayRates,
  cleanupOrphanedBillingFiles,
};
