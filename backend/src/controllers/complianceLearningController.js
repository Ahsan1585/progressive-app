const { pool } = require('../config/db');
const { normalizeForMatch } = require('../utils/textMatch');
const { computeSessionCompliance, LEARNABLE_COMPLIANCE_FIELDS } = require('./billingController');

// Billing clicks "Allow" on a flagged field: records a one-off acknowledgment
// for this exact log (unblocks Approve for it), and — for the 5 fields where
// a mismatch is usually a labeling/formatting difference rather than a
// one-time typo — also upserts a reusable learned rule so every future log
// with the same (field, state text, our value) pairing auto-matches without
// needing a human again.
const allowComplianceField = async (req, res) => {
  const { assessmentId, fieldKey } = req.body;
  if (!assessmentId || !fieldKey) {
    return res.status(400).json({ error: 'assessmentId and fieldKey are required' });
  }

  try {
    const compliance = await computeSessionCompliance(assessmentId);
    const field = compliance.fields.find((f) => f.key === fieldKey);
    if (!field) return res.status(404).json({ error: 'Field not found for this log' });
    if (field.match !== false) return res.status(400).json({ error: 'This field is not currently flagged' });

    await pool.query(
      `INSERT INTO compliance_field_acknowledgments (assessment_id, field_key, our_value, state_value, allowed_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (assessment_id, field_key) DO UPDATE SET
         our_value = EXCLUDED.our_value, state_value = EXCLUDED.state_value,
         allowed_by = EXCLUDED.allowed_by, allowed_at = now()`,
      [assessmentId, fieldKey, field.ours, field.state, req.practitioner.practitionerId]
    );

    if (LEARNABLE_COMPLIANCE_FIELDS.includes(fieldKey) && field._learn) {
      const stateValueNormalized = normalizeForMatch(field._learn.stateValueRaw || '');
      if (stateValueNormalized && field._learn.ourValue) {
        await pool.query(
          `INSERT INTO compliance_match_overrides (field_key, state_value_normalized, state_value_raw, our_value, created_by)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (field_key, state_value_normalized, our_value) DO NOTHING`,
          [fieldKey, stateValueNormalized, field._learn.stateValueRaw, field._learn.ourValue, req.practitioner.practitionerId]
        );
      }
    }

    const updated = await computeSessionCompliance(assessmentId);
    const updatedField = updated.fields.find((f) => f.key === fieldKey);
    res.json({ success: true, field: updatedField, flagged: updated.flagged });
  } catch (error) {
    console.error('Error allowing compliance field:', error);
    res.status(500).json({ error: 'Failed to allow field' });
  }
};

const listLearnedMatches = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT cmo.id, cmo.field_key, cmo.state_value_raw, cmo.our_value, cmo.created_at,
              p.first_name, p.last_name
       FROM compliance_match_overrides cmo
       LEFT JOIN practitioners p ON p.id = cmo.created_by
       ORDER BY cmo.field_key, cmo.created_at DESC`
    );
    res.json({ success: true, overrides: rows });
  } catch (error) {
    console.error('Error listing learned matches:', error);
    res.status(500).json({ error: 'Failed to list learned matches' });
  }
};

const deleteLearnedMatch = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows: overrideRows } = await pool.query(
      'SELECT field_key, state_value_normalized FROM compliance_match_overrides WHERE id = $1',
      [id]
    );
    const override = overrideRows[0];

    if (override) {
      // allowComplianceField writes a per-log acknowledgment alongside the
      // learned rule at the moment the rule is first taught — without this,
      // deleting the rule would leave the very log that taught it still
      // privately "allowed" forever, with no screen to ever find or clear
      // that acknowledgment. Acknowledgments store the display-form values
      // (not the normalized/code form the override uses), so the match has
      // to be done in JS via normalizeForMatch rather than a SQL equality.
      const { rows: ackRows } = await pool.query(
        'SELECT id, state_value FROM compliance_field_acknowledgments WHERE field_key = $1',
        [override.field_key]
      );
      const staleAckIds = ackRows
        .filter((a) => normalizeForMatch(a.state_value || '') === override.state_value_normalized)
        .map((a) => a.id);
      if (staleAckIds.length > 0) {
        await pool.query('DELETE FROM compliance_field_acknowledgments WHERE id = ANY($1::int[])', [staleAckIds]);
      }
    }

    await pool.query('DELETE FROM compliance_match_overrides WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting learned match:', error);
    res.status(500).json({ error: 'Failed to delete learned match' });
  }
};

const updateComplianceStrictness = async (req, res) => {
  const { strictness } = req.body;
  if (!['strict', 'moderate', 'lenient'].includes(strictness)) {
    return res.status(400).json({ error: 'strictness must be strict, moderate, or lenient' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO company_settings (id, compliance_strictness, updated_at) VALUES (1, $1, now())
       ON CONFLICT (id) DO UPDATE SET compliance_strictness = EXCLUDED.compliance_strictness, updated_at = now()
       RETURNING compliance_strictness`,
      [strictness]
    );
    res.json({ success: true, strictness: rows[0].compliance_strictness });
  } catch (error) {
    console.error('Error updating compliance strictness:', error);
    res.status(500).json({ error: 'Failed to update strictness' });
  }
};

module.exports = {
  allowComplianceField,
  listLearnedMatches,
  deleteLearnedMatch,
  updateComplianceStrictness,
};
