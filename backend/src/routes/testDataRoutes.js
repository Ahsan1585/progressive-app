const express = require('express');
const router = express.Router();

const { pool } = require('../config/db');
const { protect, requireRole } = require('../middleware/authMiddleware');
const {
  seedComparisonTestData,
  wipeAllSeedData,
  hardDeletePractitioner,
  randomizeSeedPractitionerDetails,
  randomizeSeedSignatures,
} = require('../controllers/testDataController');

// Test-data seeding is only wired up at all when ENABLE_TEST_SEED=true is
// set on the backend — set this in Cloud Run only while actively testing,
// then unset it. CEO-only on top of that, same as other admin-only routes.
if (process.env.ENABLE_TEST_SEED === 'true') {
  router.post('/seed-comparison-test-data', protect, requireRole(['ceo']), seedComparisonTestData);
  router.post('/wipe-all-seed-data', protect, requireRole(['ceo']), wipeAllSeedData);
  router.post('/hard-delete-practitioner', protect, requireRole(['ceo']), hardDeletePractitioner);
  router.post('/randomize-seed-practitioner-details', protect, requireRole(['ceo']), randomizeSeedPractitionerDetails);
  router.post('/randomize-seed-signatures', protect, requireRole(['ceo']), randomizeSeedSignatures);

  // Read-only diagnostic: shows exactly what's in compliance_state_logs for
  // a given child ID, to distinguish "row never parsed from the doc" from
  // "row exists but isn't linking to the patient."
  router.get('/debug-compliance-state-logs', protect, requireRole(['ceo']), async (req, res) => {
    const { childId } = req.query;
    const { rows } = await pool.query(
      `SELECT id, patient_id, child_id, child_name, practitioner_name, service_date,
              start_time, end_time, service_label, location_label, group_size_label
       FROM compliance_state_logs
       WHERE ($1::text IS NULL OR UPPER(REGEXP_REPLACE(child_id, '[^A-Za-z0-9]', '', 'g')) = UPPER(REGEXP_REPLACE($1, '[^A-Za-z0-9]', '', 'g')))
       ORDER BY service_date ASC
       LIMIT 50`,
      [childId || null]
    );
    res.json({ count: rows.length, rows });
  });

  // One-off cleanup for a seeding data-integrity gap: seed-my-session-logs
  // (used earlier to populate ahsan185's staging tenant) set
  // billing_status='completed' directly on ~55% of its rows without ever
  // creating a real billing_batches row or SEVF/invoice PDF — so those
  // sessions showed "SEVF Generated" in Session History but had no
  // corresponding entry in SEVF History (which joins through
  // billing_batches). Reverts exactly that: only the CALLING
  // practitioner's own 'completed' rows with billing_batch_id IS NULL,
  // back to 'self_certified' (the honest state — no SEVF was ever really
  // generated for them). A real 'completed' row (with a real batch) is
  // never touched.
  router.post('/fix-orphaned-completed-logs', protect, requireRole(['independent_practitioner']), async (req, res) => {
    const practitionerId = req.practitioner.practitionerId;
    const { rows } = await pool.query(
      `UPDATE assessments SET billing_status = 'self_certified'
       WHERE practitioner_id = $1 AND billing_status = 'completed' AND billing_batch_id IS NULL
       RETURNING id`,
      [practitionerId]
    );
    res.json({ success: true, reverted: rows.length });
  });
}

module.exports = router;
