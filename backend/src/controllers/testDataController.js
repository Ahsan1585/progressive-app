const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { logAudit } = require('../utils/auditLog');

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
};
const VISIT_STATUS_LABEL_TO_CODE = {
  'Direct Child Service': '1', 'Practitioner Cancelled (inc weather related)': '2',
  'Family Cancelled (inc weather related)': '3', 'Make Up Direct Child Service': '4',
  'Makeup Direct Child Service': '4',
  'Family Missed (within 3 hours)': '5', 'Team Mtg – IFSP': 'IFSP',
  'Transition Planning Conference': 'TPC', 'Bilingual Interpretation': 'IT',
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

module.exports = { seedComparisonTestData, wipeAllSeedData, hardDeletePractitioner };
