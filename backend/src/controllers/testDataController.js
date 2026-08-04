const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { logAudit } = require('../utils/auditLog');

const SEED_PASSWORD = 'TestData@2026';

// The real "Group Size" dropdown category (add_dropdown_options.sql) has
// exactly these two codes/labels — map incoming free-text labels to the
// real code so it lands in assessments.group_size_category like a normal
// submission would, instead of a made-up field.
const GROUP_SIZE_LABEL_TO_CODE = {
  'Direct Child Service - Individual': 'individual',
  'Consultation/Facilitation with Others': 'consultation',
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
 *     serviceType, location, groupSize, discipline, notes
 *   }]
 * }
 *
 * Idempotent: first deletes every previously seeded row (practitioners
 * whose email starts with "seed-", and their patients/assessments via FK
 * cascade-by-hand), then recreates everything fresh from the payload.
 */
const seedComparisonTestData = async (req, res) => {
  const { practitioners = [], children = [], sessions = [] } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Wipe previously seeded data (assessments -> patient_practitioners -> patients -> practitioners).
    // child_id is left exactly as given (no prefix) so it can match a real
    // compliance-reference document by its real state-issued ID — so a
    // seeded patient is instead identified by being linked ONLY to seed
    // practitioners (never a real one), not by any marker on its own row.
    const { rows: oldPracRows } = await client.query(
      `SELECT id FROM practitioners WHERE email LIKE 'seed-%'`
    );
    const oldPracIds = oldPracRows.map((r) => r.id);
    if (oldPracIds.length > 0) {
      const { rows: seedOnlyPatientRows } = await client.query(
        `SELECT patient_id FROM patient_practitioners
         GROUP BY patient_id
         HAVING bool_and(practitioner_id = ANY($1::int[]))`,
        [oldPracIds]
      );
      const seedOnlyPatientIds = seedOnlyPatientRows.map((r) => r.patient_id);

      await client.query(`DELETE FROM assessment_notes WHERE author_id = ANY($1::int[])`, [oldPracIds]);
      await client.query(`DELETE FROM assessments WHERE practitioner_id = ANY($1::int[])`, [oldPracIds]);
      await client.query(`DELETE FROM patient_practitioners WHERE practitioner_id = ANY($1::int[])`, [oldPracIds]);
      await client.query(
        `DELETE FROM billing_locks WHERE practitioner_id = ANY($1::int[]) OR locked_by = ANY($1::int[])`,
        [oldPracIds]
      );
      if (seedOnlyPatientIds.length > 0) {
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
    // against it in the sessions payload.
    const patientIdByChildId = {};
    for (const c of children) {
      const { rows } = await client.query(
        `INSERT INTO patients (first_name, last_name, dob, county, child_id, status)
         VALUES ($1, $2, $3, $4, $5, 'active')
         RETURNING id`,
        [c.firstName, c.lastName, c.dob, c.county || 'Essex', c.childId]
      );
      patientIdByChildId[c.childId] = rows[0].id;
    }

    const linked = new Set();
    for (const s of sessions) {
      const patientId = patientIdByChildId[s.childId];
      const practitionerId = practitionerIdByEmail[s.practitionerEmail.trim().toLowerCase()];
      const linkKey = `${patientId}:${practitionerId}`;
      if (patientId && practitionerId && !linked.has(linkKey)) {
        await client.query(
          `INSERT INTO patient_practitioners (patient_id, practitioner_id) VALUES ($1, $2)`,
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

      const groupSizeCode = GROUP_SIZE_LABEL_TO_CODE[s.groupSize] || null;

      const { rows: insertedRows } = await client.query(
        `INSERT INTO assessments
           (patient_id, practitioner_id, patient_first_name, patient_last_name, patient_dob, patient_county,
            practitioner_first_name, practitioner_last_name, practitioner_discipline,
            service_date, start_time, end_time, total_time, status, type, location, group_size_category,
            parent_signature, practitioner_signature, form_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending', $14, $15, $16, $17, $18, $19)
         RETURNING id`,
        [
          patientId, practitionerId,
          child?.firstName, child?.lastName, child?.dob, child?.county || 'Essex',
          prac?.firstName, prac?.lastName, s.discipline || null,
          s.serviceDate, s.startTime || null, s.endTime || null, s.totalTime || 0,
          s.serviceType || null, s.location || null, groupSizeCode,
          PLACEHOLDER_SIGNATURE, PLACEHOLDER_SIGNATURE,
          JSON.stringify({ custom_fields: {} }),
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

module.exports = { seedComparisonTestData };
