const { pool } = require('../config/db');
const { loadDropdownOptionsCache } = require('../constants/dropdownOptionsCache');

// Full set of categories (built-in + custom) — used by the admin UI's
// category-management tab and to populate the log form's dropdown groups.
async function listDropdownCategories(req, res) {
  try {
    const { rows } = await pool.query(
      'SELECT id, key, display_name, is_custom, is_required_on_log, sort_order, is_active FROM dropdown_categories ORDER BY sort_order, key'
    );
    res.json({ categories: rows });
  } catch (err) {
    console.error('List dropdown categories error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

function slugify(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

async function createDropdownCategory(req, res) {
  const { displayName, isRequiredOnLog } = req.body;
  if (!displayName || !displayName.trim()) {
    return res.status(400).json({ error: 'A category name is required.' });
  }
  const key = slugify(displayName);
  if (!key) {
    return res.status(400).json({ error: 'That name could not be turned into a valid category key — try including at least one letter or number.' });
  }
  try {
    const { rows: existing } = await pool.query('SELECT id FROM dropdown_categories WHERE key = $1', [key]);
    if (existing[0]) {
      return res.status(409).json({ error: 'A category with that name already exists.' });
    }
    const { rows: maxSort } = await pool.query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM dropdown_categories');
    const { rows } = await pool.query(
      `INSERT INTO dropdown_categories (key, display_name, is_custom, is_required_on_log, sort_order)
       VALUES ($1, $2, true, $3, $4)
       RETURNING id, key, display_name, is_custom, is_required_on_log, sort_order, is_active`,
      [key, displayName.trim(), Boolean(isRequiredOnLog), maxSort[0].next]
    );
    // Refresh the cache the same way every dropdown-option write already does
    // (dropdownOptionsController's createDropdownOption/updateDropdownOption/
    // deactivateDropdownOption/reactivateDropdownOption all call this with no
    // argument, relying on loadDropdownOptionsCache's default parameter to
    // resolve the current tenant via getCurrentTenantDb()), so this new
    // category is immediately usable for the log form/matching.
    await loadDropdownOptionsCache();
    res.status(201).json({ category: rows[0] });
  } catch (err) {
    console.error('Create dropdown category error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function updateDropdownCategory(req, res) {
  const { id } = req.params;
  const { displayName, isRequiredOnLog } = req.body;
  try {
    const { rows: existing } = await pool.query('SELECT is_custom FROM dropdown_categories WHERE id = $1', [id]);
    if (!existing[0]) return res.status(404).json({ error: 'Category not found.' });
    if (!existing[0].is_custom) return res.status(400).json({ error: 'This is a built-in category and cannot be edited.' });

    const sets = [];
    const values = [];
    if (displayName !== undefined) { values.push(displayName.trim()); sets.push(`display_name = $${values.length}`); }
    if (isRequiredOnLog !== undefined) { values.push(Boolean(isRequiredOnLog)); sets.push(`is_required_on_log = $${values.length}`); }
    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update.' });
    values.push(id);
    const { rows } = await pool.query(
      `UPDATE dropdown_categories SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length}
       RETURNING id, key, display_name, is_custom, is_required_on_log, sort_order, is_active`,
      values
    );
    await loadDropdownOptionsCache();
    res.json({ category: rows[0] });
  } catch (err) {
    console.error('Update dropdown category error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function deleteDropdownCategory(req, res) {
  const { id } = req.params;
  try {
    const { rows: existing } = await pool.query('SELECT key, is_custom FROM dropdown_categories WHERE id = $1', [id]);
    if (!existing[0]) return res.status(404).json({ error: 'Category not found.' });
    if (!existing[0].is_custom) return res.status(400).json({ error: 'This is a built-in category and cannot be deleted.' });

    const { rows: settingsRows } = await pool.query('SELECT compliance_doc_custom_fields FROM company_settings WHERE id = 1');
    const customFields = settingsRows[0]?.compliance_doc_custom_fields || [];
    const stillMapped = customFields.some((cf) => cf.compareTo === `custom_category:${existing[0].key}`);
    if (stillMapped) {
      return res.status(409).json({ error: 'This category is still mapped as a comparison field in State Compliance Reference — remove that mapping first.' });
    }

    // dropdown_options.category REFERENCES dropdown_categories.key with no
    // explicit ON DELETE clause (defaults to NO ACTION/RESTRICT per Task 1's
    // migration), so this DELETE fails with a 23503 FK violation if any
    // dropdown_options rows still reference this category — caught below and
    // surfaced as a clear error instead of a raw Postgres one.
    await pool.query('DELETE FROM dropdown_categories WHERE id = $1', [id]);
    await loadDropdownOptionsCache();
    res.status(204).send();
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({ error: 'This category still has options defined — remove them first.' });
    }
    console.error('Delete dropdown category error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { listDropdownCategories, createDropdownCategory, updateDropdownCategory, deleteDropdownCategory };
