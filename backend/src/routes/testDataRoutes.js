const express = require('express');
const router = express.Router();

const { protect, requireRole } = require('../middleware/authMiddleware');
const { seedComparisonTestData } = require('../controllers/testDataController');

// Test-data seeding is only wired up at all when ENABLE_TEST_SEED=true is
// set on the backend — set this in Cloud Run only while actively testing,
// then unset it. CEO-only on top of that, same as other admin-only routes.
if (process.env.ENABLE_TEST_SEED === 'true') {
  router.post('/seed-comparison-test-data', protect, requireRole(['ceo']), seedComparisonTestData);
}

module.exports = router;
