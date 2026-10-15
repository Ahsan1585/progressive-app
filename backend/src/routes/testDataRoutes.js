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
  generateLiveSessions,
  wipeGeneratedLiveSessions,
  refreshGeneratedSignatures,
  backfillGeneratedCompletedAt,
  anonymizeTenantRoster,
  wipeTenantRosterCompletely,
  createDummyRoster,
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
  router.post('/generate-live-sessions', protect, requireRole(['ceo']), generateLiveSessions);
  router.post('/wipe-generated-live-sessions', protect, requireRole(['ceo']), wipeGeneratedLiveSessions);
  router.post('/refresh-generated-signatures', protect, requireRole(['ceo']), refreshGeneratedSignatures);
  router.post('/backfill-generated-completed-at', protect, requireRole(['ceo']), backfillGeneratedCompletedAt);
  router.post('/anonymize-tenant-roster', protect, requireRole(['ceo']), anonymizeTenantRoster);
  router.post('/wipe-tenant-roster-completely', protect, requireRole(['ceo']), wipeTenantRosterCompletely);
  router.post('/create-dummy-roster', protect, requireRole(['ceo']), createDummyRoster);

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

  // One-off verification helper for the roster-anonymization pass — checks
  // whether any of a given list of old full names still appear anywhere in
  // compliance_state_logs (not capped at 50, unlike the childId-scoped
  // debug endpoint above).
  router.post('/debug-check-names-remaining', protect, requireRole(['ceo']), async (req, res) => {
    const { names = [] } = req.body;
    const { rows: childRows } = await pool.query(
      `SELECT DISTINCT child_name AS name FROM compliance_state_logs WHERE child_name = ANY($1::text[])`,
      [names]
    );
    const { rows: pracRows } = await pool.query(
      `SELECT DISTINCT practitioner_name AS name FROM compliance_state_logs WHERE practitioner_name = ANY($1::text[])`,
      [names]
    );
    const { rows: totalRows } = await pool.query(`SELECT COUNT(*)::int AS count FROM compliance_state_logs`);
    res.json({
      totalRowsInTable: totalRows[0].count,
      childNamesStillPresent: childRows.map((r) => r.name),
      practitionerNamesStillPresent: pracRows.map((r) => r.name),
    });
  });
}

module.exports = router;
