const express = require('express');
const router = express.Router();

const { pool } = require('../config/db');
const { protect, requireRole } = require('../middleware/authMiddleware');
const { seedComparisonTestData, wipeAllSeedData, hardDeletePractitioner } = require('../controllers/testDataController');

// Test-data seeding is only wired up at all when ENABLE_TEST_SEED=true is
// set on the backend — set this in Cloud Run only while actively testing,
// then unset it. CEO-only on top of that, same as other admin-only routes.
if (process.env.ENABLE_TEST_SEED === 'true') {
  router.post('/seed-comparison-test-data', protect, requireRole(['ceo']), seedComparisonTestData);
  router.post('/wipe-all-seed-data', protect, requireRole(['ceo']), wipeAllSeedData);
  router.post('/hard-delete-practitioner', protect, requireRole(['ceo']), hardDeletePractitioner);

  // Read-only diagnostic: shows exactly what's in compliance_state_logs for
  // a given child ID, to distinguish "row never parsed from the doc" from
  // "row exists but isn't linking to the patient."
  router.get('/debug-compliance-state-logs', protect, requireRole(['ceo']), async (req, res) => {
    const { childId } = req.query;
    const { rows } = await pool.query(
      `SELECT id, patient_id, child_id, child_name, practitioner_name, service_date,
              start_time, end_time, service_label, location_label, group_size_label
       FROM compliance_state_logs
       WHERE ($1::text IS NULL OR UPPER(REGEXP_REPLACE(child_id, '\\s+', '', 'g')) = UPPER(REGEXP_REPLACE($1, '\\s+', '', 'g')))
       ORDER BY service_date ASC
       LIMIT 50`,
      [childId || null]
    );
    res.json({ count: rows.length, rows });
  });
}

module.exports = router;
