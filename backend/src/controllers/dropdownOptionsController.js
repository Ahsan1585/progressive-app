const { pool } = require('../config/db');
const { loadDropdownOptionsCache, getDropdownOptionsCache } = require('../constants/dropdownOptionsCache');

// The 4 built-in categories store their code directly on a dedicated
// assessments column; company_affiliation also has its own dedicated
// column (see assessments.company_affiliation, added for the independent-
// practitioner feature) rather than living in form_data like a genuinely
// custom category's values do. Any other category key falls through to the
// form_data->custom_fields JSON lookup.
const DIRECT_COLUMN_BY_CATEGORY = {
  service_type: 'type',
  service_status: 'status',
  location: 'location',
  group_size: 'group_size_category',
  company_affiliation: 'company_affiliation',
};

// Counts how many assessments rows currently use this option's code within
// its own category — used to gate hard-delete (see deleteDropdownOptionPermanently
// below). Never throws on an unexpected category; falls back to the
// custom_fields JSON path for anything not in DIRECT_COLUMN_BY_CATEGORY.
async function countAssessmentsUsingOption(category, code) {
  const directColumn = DIRECT_COLUMN_BY_CATEGORY[category];
  const sql = directColumn
    ? `SELECT COUNT(*)::int AS count FROM assessments WHERE ${directColumn} = $1`
    : `SELECT COUNT(*)::int AS count FROM assessments WHERE form_data->'custom_fields'->>$2 = $1`;
  const params = directColumn ? [code] : [code, category];
  const { rows } = await pool.query(sql, params);
  return rows[0]?.count || 0;
}

// Full set (active + inactive) grouped by category — the admin UI needs
// inactive rows to offer "Reactivate"; the log-form dropdowns filter to
// is_active client-side.
const getDropdownOptions = (req, res) => {
  res.json({ success: true, options: getDropdownOptionsCache() });
};

const createDropdownOption = async (req, res) => {
  const { category, code, label, sort_order } = req.body;
  if (!code || !String(code).trim() || !label || !String(label).trim()) {
    return res.status(400).json({ error: 'Code and name are required' });
  }
  try {
    const { rows: categoryRows } = await pool.query(
      'SELECT 1 FROM dropdown_categories WHERE key = $1 AND is_active = true',
      [category]
    );
    if (!categoryRows[0]) {
      return res.status(400).json({ error: 'Invalid category' });
    }
    // Re-adding a code that was previously deactivated reactivates it (and
    // updates its label) rather than erroring on the UNIQUE(category, code)
    // constraint — keeps the same row/id so history association is preserved.
    const { rows } = await pool.query(
      `INSERT INTO dropdown_options (category, code, label, sort_order)
       VALUES ($1, $2, $3, COALESCE($4, 0))
       ON CONFLICT (category, code) DO UPDATE SET
         label = EXCLUDED.label, is_active = true, updated_at = now()
       RETURNING *`,
      [category, String(code).trim(), String(label).trim(), sort_order ?? null]
    );
    await loadDropdownOptionsCache();
    res.status(201).json({ success: true, option: rows[0] });
  } catch (error) {
    console.error('Error creating dropdown option:', error);
    res.status(500).json({ error: 'Failed to create option' });
  }
};

const updateDropdownOption = async (req, res) => {
  const { id } = req.params;
  const { code, label, sort_order } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE dropdown_options SET
         code = COALESCE($1, code),
         label = COALESCE($2, label),
         sort_order = COALESCE($3, sort_order),
         updated_at = now()
       WHERE id = $4
       RETURNING *`,
      [code ?? null, label ?? null, sort_order ?? null, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Option not found' });
    await loadDropdownOptionsCache();
    res.json({ success: true, option: rows[0] });
  } catch (error) {
    console.error('Error updating dropdown option:', error);
    res.status(500).json({ error: 'Failed to update option' });
  }
};

// Soft-delete: never a real DELETE, so a code already used on historical
// logs keeps resolving to its label — only hidden from new-log dropdowns.
const deactivateDropdownOption = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `UPDATE dropdown_options SET is_active = false, updated_at = now() WHERE id = $1 RETURNING *`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Option not found' });
    await loadDropdownOptionsCache();
    res.json({ success: true, option: rows[0] });
  } catch (error) {
    console.error('Error deactivating dropdown option:', error);
    res.status(500).json({ error: 'Failed to delete option' });
  }
};

// DELETE /api/dropdown-options/:id/permanent — a real, irreversible DELETE,
// unlike deactivateDropdownOption above. Only ever allowed for a
// practitioner/company-added option (is_seeded = false) that no existing
// assessment currently references — a seeded, state-mandated default code
// (EV, AS, IFSP, ...) can never be hard-deleted even if unused, and a
// used-but-custom option is refused with a clear count so the caller can
// deactivate instead, rather than silently leaving historical logs/
// generated PDFs with a code that no longer resolves to any label.
const deleteDropdownOptionPermanently = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows: existingRows } = await pool.query(
      'SELECT id, category, code, label, is_seeded FROM dropdown_options WHERE id = $1',
      [id]
    );
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ error: 'Option not found' });

    if (existing.is_seeded) {
      return res.status(400).json({ error: 'This is a default option and can only be deactivated, not permanently deleted.' });
    }

    const usageCount = await countAssessmentsUsingOption(existing.category, existing.code);
    if (usageCount > 0) {
      return res.status(409).json({
        error: `"${existing.label}" is used on ${usageCount} existing log${usageCount === 1 ? '' : 's'} and can't be permanently deleted — deactivate it instead so new logs stop offering it, while old logs keep showing "${existing.label}".`,
      });
    }

    await pool.query('DELETE FROM dropdown_options WHERE id = $1', [id]);
    await loadDropdownOptionsCache();
    res.status(204).send();
  } catch (error) {
    console.error('Error permanently deleting dropdown option:', error);
    res.status(500).json({ error: 'Failed to delete option' });
  }
};

const reactivateDropdownOption = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `UPDATE dropdown_options SET is_active = true, updated_at = now() WHERE id = $1 RETURNING *`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Option not found' });
    await loadDropdownOptionsCache();
    res.json({ success: true, option: rows[0] });
  } catch (error) {
    console.error('Error reactivating dropdown option:', error);
    res.status(500).json({ error: 'Failed to reactivate option' });
  }
};

module.exports = {
  getDropdownOptions,
  createDropdownOption,
  updateDropdownOption,
  deactivateDropdownOption,
  deleteDropdownOptionPermanently,
  reactivateDropdownOption,
};
